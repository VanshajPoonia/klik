import { and, asc, cosineDistance, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { albums, media, mediaVision, type Media } from "./schema";
import { mediaVisibilityFilter, type MediaAccessEvent, type MediaViewer } from "./media-access";
import { embedTexts, isVisionConfigured } from "./ai/workers-ai";
import {
  MAX_SCENES,
  MIN_SCENE_PHOTOS,
  isSceneLabel,
  labelsForQuery,
  normalizeQuery,
  parseSmartFolderQuery,
  rankCandidates,
  type SceneLabel,
  type SmartFolderQuery,
} from "./vision";

/**
 * AI-2 and AI-4: searching an event's photos by meaning, its scenes, and the
 * smart folders a host saves from either.
 *
 * Every query here goes through `mediaVisibilityFilter`, the one rule the grid
 * and the content route already share, so a search can never surface a photo
 * the person searching could not have scrolled to. Results are media rows in
 * the gallery's own shape; callers sign them as they sign a page of the grid.
 */

/** How many candidates the database hands over before ranking. */
const CANDIDATES = 200;

/**
 * A query's embedding, kept for an hour in this instance, so "cake", "cake"
 * and "cake" again cost one call. Small and bounded: searches are short.
 */
const queryCache = new Map<string, { vector: number[]; at: number }>();
const QUERY_CACHE_MS = 60 * 60 * 1000;
const QUERY_CACHE_SIZE = 500;

export async function queryEmbedding(text: string): Promise<number[]> {
  const key = normalizeQuery(text).toLowerCase();
  const hit = queryCache.get(key);
  if (hit && Date.now() - hit.at < QUERY_CACHE_MS) return hit.vector;
  const [vector] = await embedTexts([key]);
  if (queryCache.size >= QUERY_CACHE_SIZE) queryCache.delete(queryCache.keys().next().value as string);
  queryCache.set(key, { vector, at: Date.now() });
  return vector;
}

type Viewer = MediaViewer;
type SearchEvent = MediaAccessEvent & { id: string };

function visibleTo(viewer: Viewer, event: SearchEvent) {
  const filter = mediaVisibilityFilter(viewer, event);
  return and(eq(media.eventId, event.id), isNull(media.deletedAt), filter);
}

async function rowsInOrder(event: SearchEvent, viewer: Viewer, ids: string[]): Promise<Array<Media & { mine: boolean }>> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(media).where(and(visibleTo(viewer, event), inArray(media.id, ids)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is Media => Boolean(row))
    .map((row) => ({ ...row, mine: viewer.guestId != null && row.guestId === viewer.guestId }));
}

/** A text[] literal from bound parameters, one per label. */
function labelArray(labels: readonly SceneLabel[]) {
  return sql`ARRAY[${sql.join(
    labels.map((label) => sql`${label}`),
    sql`, `,
  )}]::text[]`;
}

/** By meaning, with photos carrying a label the query named outright first among equals. */
export async function searchByText(
  event: SearchEvent,
  viewer: Viewer,
  text: string,
  vector?: number[],
): Promise<Array<Media & { mine: boolean }>> {
  const query = normalizeQuery(text);
  if (!query) return [];
  const embedding = vector ?? (await queryEmbedding(query));
  const distance = cosineDistance(mediaVision.embedding, embedding);
  const named = labelsForQuery(query);
  const [nearest, labelled] = await Promise.all([
    db
      .select({ id: media.id, labels: mediaVision.labels, distance: sql<number>`${distance}`.mapWith(Number) })
      .from(media)
      .innerJoin(mediaVision, eq(mediaVision.mediaId, media.id))
      .where(and(visibleTo(viewer, event), eq(mediaVision.state, "done"), sql`${mediaVision.embedding} IS NOT NULL`))
      .orderBy(distance)
      .limit(CANDIDATES),
    named.length > 0
      ? db
          .select({ id: media.id, labels: mediaVision.labels, distance: sql<number>`${distance}`.mapWith(Number) })
          .from(media)
          .innerJoin(mediaVision, eq(mediaVision.mediaId, media.id))
          .where(and(visibleTo(viewer, event), sql`${mediaVision.labels} && ${labelArray(named)}`))
          .orderBy(desc(media.createdAt))
          .limit(CANDIDATES)
      : Promise.resolve([]),
  ]);
  const candidates = new Map<string, { id: string; similarity: number; labels: string[] }>();
  for (const row of [...nearest, ...labelled]) {
    // A null distance (no embedding) still counts for its label.
    candidates.set(row.id, { id: row.id, labels: row.labels, similarity: row.distance == null ? 0 : 1 - row.distance });
  }
  return rowsInOrder(event, viewer, rankCandidates([...candidates.values()], named));
}

/** Every photo with one label, newest first, as the grid orders them. */
export async function searchByScene(
  event: SearchEvent,
  viewer: Viewer,
  label: SceneLabel,
  limit = CANDIDATES,
): Promise<Array<Media & { mine: boolean }>> {
  const rows = await db
    .select({ row: media })
    .from(media)
    .innerJoin(mediaVision, eq(mediaVision.mediaId, media.id))
    .where(and(visibleTo(viewer, event), sql`${mediaVision.labels} @> ${labelArray([label])}`))
    .orderBy(desc(media.createdAt), desc(media.id))
    .limit(limit);
  return rows.map(({ row }) => ({ ...row, mine: viewer.guestId != null && row.guestId === viewer.guestId }));
}

export interface StoredSmartQuery {
  type: "search" | "scene";
  text?: string;
  label?: SceneLabel;
  /** The search's embedding, made once when the folder is saved, so opening
   * it costs nothing and keeps working if the key is ever removed. */
  vector?: number[];
}

export async function searchBySmartFolder(
  event: SearchEvent,
  viewer: Viewer,
  folder: { query: unknown },
): Promise<Array<Media & { mine: boolean }>> {
  const query = parseSmartFolderQuery(folder.query);
  if (!query) return [];
  if (query.type === "scene") return searchByScene(event, viewer, query.label);
  const stored = (folder.query as StoredSmartQuery).vector;
  const vector = Array.isArray(stored) && stored.length > 0 ? stored : undefined;
  if (!vector && !isVisionConfigured()) return [];
  return searchByText(event, viewer, query.text, vector);
}

export interface GalleryScene {
  label: SceneLabel;
  count: number;
}

export interface SmartFolderSummary {
  id: string;
  name: string;
  query: SmartFolderQuery;
}

export interface GallerySearchPayload {
  /** Whether a search box is worth showing: a key to embed the query, and something described. */
  searchable: boolean;
  scenes: GalleryScene[];
  folders: SmartFolderSummary[];
}

const EMPTY: GallerySearchPayload = { searchable: false, scenes: [], folders: [] };

/** Smart folders are albums of kind `smart` whose query is not a moment's. */
function isSmartFolderQuery(query: unknown): boolean {
  return parseSmartFolderQuery(query) !== null;
}

export async function listSmartFolders(eventId: string): Promise<SmartFolderSummary[]> {
  const rows = await db
    .select({ id: albums.id, name: albums.name, query: albums.query })
    .from(albums)
    .where(and(eq(albums.eventId, eventId), eq(albums.kind, "smart"), isNull(albums.deletedAt)))
    .orderBy(asc(albums.position), asc(albums.createdAt));
  return rows
    .filter((row) => isSmartFolderQuery(row.query))
    .map((row) => ({ id: row.id, name: row.name, query: parseSmartFolderQuery(row.query)! }));
}

/**
 * What a gallery shows above the grid: whether it can be searched, the scenes
 * with enough photos this viewer can see, and the host's smart folders. Guests
 * get nothing when the host has scenes off.
 */
export async function gallerySearch(
  event: SearchEvent & { scenesEnabled: boolean },
  viewer: Viewer,
): Promise<GallerySearchPayload> {
  if (!viewer.isManager && !event.scenesEnabled) return EMPTY;
  const filter = mediaVisibilityFilter(viewer, event);
  const [scenes, described, folders] = await Promise.all([
    db.execute(sql`
      SELECT scene AS label, count(*)::int AS count
      FROM ${media}
      JOIN ${mediaVision} ON ${mediaVision.mediaId} = ${media.id}
      CROSS JOIN LATERAL unnest(${mediaVision.labels}) AS scene
      WHERE ${media.eventId} = ${event.id} AND ${media.deletedAt} IS NULL ${filter ? sql`AND ${filter}` : sql``}
      GROUP BY scene
      HAVING count(*) >= ${MIN_SCENE_PHOTOS}
      ORDER BY count(*) DESC, scene
      LIMIT ${MAX_SCENES}
    `),
    db
      .select({ id: mediaVision.mediaId })
      .from(mediaVision)
      .where(and(eq(mediaVision.eventId, event.id), eq(mediaVision.state, "done")))
      .limit(1),
    listSmartFolders(event.id),
  ]);
  const rows = (scenes as unknown as { rows: Array<{ label: string; count: number }> }).rows;
  return {
    searchable: isVisionConfigured() && described.length > 0,
    scenes: rows.filter((row) => isSceneLabel(row.label)).map((row) => ({ label: row.label as SceneLabel, count: Number(row.count) })),
    folders,
  };
}

export class SmartFolderError extends Error {
  constructor(readonly code: "invalid" | "not_configured" | "too_many" | "not_found") {
    super(code);
  }
}

/** A host's saved searches and scenes, per event. Generous; it is a list of chips. */
export const MAX_SMART_FOLDERS = 20;

export async function createSmartFolder(
  eventId: string,
  { name, query }: { name: string; query: SmartFolderQuery },
): Promise<SmartFolderSummary> {
  const existing = await listSmartFolders(eventId);
  if (existing.length >= MAX_SMART_FOLDERS) throw new SmartFolderError("too_many");
  let stored: StoredSmartQuery;
  if (query.type === "search") {
    if (!isVisionConfigured()) throw new SmartFolderError("not_configured");
    stored = { type: "search", text: query.text, vector: await queryEmbedding(query.text) };
  } else {
    stored = { type: "scene", label: query.label };
  }
  const id = nanoid();
  await db.insert(albums).values({
    id,
    eventId,
    name: name.trim().slice(0, 60),
    kind: "smart",
    query: stored,
    position: existing.length,
  });
  return { id, name: name.trim().slice(0, 60), query };
}

export async function smartFolder(eventId: string, id: string) {
  const [row] = await db
    .select({ id: albums.id, name: albums.name, query: albums.query })
    .from(albums)
    .where(and(eq(albums.id, id), eq(albums.eventId, eventId), eq(albums.kind, "smart"), isNull(albums.deletedAt)))
    .limit(1);
  return row && isSmartFolderQuery(row.query) ? row : null;
}

export async function renameSmartFolder(eventId: string, id: string, name: string): Promise<boolean> {
  if (!(await smartFolder(eventId, id))) return false;
  await db
    .update(albums)
    .set({ name: name.trim().slice(0, 60) })
    .where(and(eq(albums.id, id), eq(albums.eventId, eventId)));
  return true;
}

/** Hard delete: a smart folder holds no photos, only a question. */
export async function deleteSmartFolder(eventId: string, id: string): Promise<boolean> {
  if (!(await smartFolder(eventId, id))) return false;
  await db.delete(albums).where(and(eq(albums.id, id), eq(albums.eventId, eventId)));
  return true;
}
