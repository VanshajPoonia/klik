import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";
import { db } from "./db";
import { deleteBlobs, r2 } from "./storage";
import { printAssets, printDesignVersions, printDesigns, type PrintAsset, type PrintDesign } from "./schema";
import { MAX_DOC_BYTES, docAssetIds, upgradeDoc, type PrintDoc } from "./print/doc";
import { CUSTOM_PRESET_KEY, MAX_CUSTOM_MM, MIN_CUSTOM_MM, findPreset, type DesignSize } from "./print/presets";

/**
 * QR-4a and QR-4c, the database and storage side of the print studio.
 *
 * Designs autosave as the host works, so a save carries the revision it was
 * made from and is refused when another tab or a co-host has saved since:
 * silently keeping whichever arrived last loses the other person's work
 * without either of them knowing. The host is shown the conflict and chooses.
 *
 * Every few minutes of work, the state being replaced is kept as a version,
 * ten at most, so a change autosave has already kept is still recoverable.
 *
 * Uploaded images live under `designs/<eventId>/`, outside `events/`, so the
 * orphan reaper (which judges `events/` against media rows) never sees them
 * and the backup never copies them. They are deleted with the event.
 */

export const MAX_DESIGNS_PER_EVENT = 50;
export const MAX_ASSETS_PER_EVENT = 100;
export const MAX_ASSET_BYTES = 15 * 1024 * 1024;
export const MAX_ASSET_PIXELS = 10_000;
export const MAX_THUMBNAIL_BYTES = 400 * 1024;
export const MAX_VERSIONS = 10;
/** A version is kept at most this often, so ten of them cover real time. */
export const VERSION_INTERVAL_MS = 5 * 60 * 1000;

export const ASSET_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AssetMime = (typeof ASSET_MIME_TYPES)[number];
const EXTENSION: Record<AssetMime, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export class DesignError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function assetKey(eventId: string, assetId: string, mime: AssetMime): string {
  return `designs/${eventId}/${assetId}.${EXTENSION[mime]}`;
}

export function thumbnailKey(eventId: string, designId: string): string {
  return `designs/${eventId}/${designId}-thumb.jpg`;
}

/** A size from a preset, or a custom one within bounds. */
export function resolveSize(input: { preset: string; widthMm?: number; heightMm?: number }): DesignSize {
  const preset = findPreset(input.preset);
  if (preset) return { preset: preset.key, widthMm: preset.widthMm, heightMm: preset.heightMm, bleedMm: preset.bleedMm };
  if (input.preset !== CUSTOM_PRESET_KEY || input.widthMm == null || input.heightMm == null) {
    throw new DesignError(400, "Choose a size for the design.");
  }
  const inBounds = (mm: number) => Number.isFinite(mm) && mm >= MIN_CUSTOM_MM && mm <= MAX_CUSTOM_MM;
  if (!inBounds(input.widthMm) || !inBounds(input.heightMm)) {
    throw new DesignError(400, `A custom size is between ${MIN_CUSTOM_MM / 10} and ${MAX_CUSTOM_MM / 10} cm on each side.`);
  }
  const round = (mm: number) => Math.round(mm * 10) / 10;
  return { preset: CUSTOM_PRESET_KEY, widthMm: round(input.widthMm), heightMm: round(input.heightMm), bleedMm: 3 };
}

/**
 * A design as a client sent it, checked: the current schema, within size, and
 * drawing only images this event owns. An id from another event would be
 * refused by the asset route anyway; refusing it here keeps the stored design
 * honest about what it can draw.
 */
export async function checkDoc(eventId: string, raw: unknown): Promise<PrintDoc> {
  if (JSON.stringify(raw ?? null).length > MAX_DOC_BYTES) throw new DesignError(413, "This design is too large to save.");
  const doc = upgradeDoc(raw);
  if (!doc) throw new DesignError(400, "This design could not be read.");
  const wanted = docAssetIds(doc);
  if (wanted.length > 0) {
    const owned = await db
      .select({ id: printAssets.id })
      .from(printAssets)
      .where(and(eq(printAssets.eventId, eventId), inArray(printAssets.id, wanted)));
    if (owned.length !== wanted.length) throw new DesignError(400, "This design uses a photo that is no longer here.");
  }
  return doc;
}

/** The list, without the scenes themselves. */
export async function listDesigns(eventId: string) {
  return db
    .select({
      id: printDesigns.id,
      name: printDesigns.name,
      preset: printDesigns.preset,
      widthMm: printDesigns.widthMm,
      heightMm: printDesigns.heightMm,
      bleedMm: printDesigns.bleedMm,
      revision: printDesigns.revision,
      thumbnailKey: printDesigns.thumbnailKey,
      updatedAt: printDesigns.updatedAt,
    })
    .from(printDesigns)
    .where(eq(printDesigns.eventId, eventId))
    .orderBy(desc(printDesigns.updatedAt));
}

export async function getDesign(eventId: string, designId: string): Promise<PrintDesign | null> {
  const [row] = await db
    .select()
    .from(printDesigns)
    .where(and(eq(printDesigns.id, designId), eq(printDesigns.eventId, eventId)))
    .limit(1);
  return row ?? null;
}

export async function createDesign(input: {
  eventId: string;
  name: string;
  size: DesignSize;
  doc: PrintDoc;
  createdBy: string;
}): Promise<PrintDesign> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(printDesigns)
    .where(eq(printDesigns.eventId, input.eventId));
  if (count >= MAX_DESIGNS_PER_EVENT) {
    throw new DesignError(409, `An event can hold ${MAX_DESIGNS_PER_EVENT} designs. Delete one you no longer need.`);
  }
  const [row] = await db
    .insert(printDesigns)
    .values({
      id: nanoid(),
      eventId: input.eventId,
      name: input.name,
      ...input.size,
      doc: input.doc,
      createdBy: input.createdBy,
    })
    .returning();
  return row;
}

export type SaveResult = { ok: true; design: PrintDesign } | { ok: false; current: PrintDesign };

/**
 * A save. Refused when `baseRevision` is not the stored one, unless `force`,
 * which is the host choosing to keep their copy over the other one. The check
 * and the write are one conditional UPDATE, because `neon-http` has no
 * transactions and a read-then-write would let two saves both pass.
 */
export async function saveDesign(
  eventId: string,
  designId: string,
  changes: { doc?: PrintDoc; name?: string },
  { baseRevision, force = false }: { baseRevision: number; force?: boolean },
): Promise<SaveResult | null> {
  const current = await getDesign(eventId, designId);
  if (!current) return null;
  if (!force && current.revision !== baseRevision) return { ok: false, current };

  const [updated] = await db
    .update(printDesigns)
    .set({
      ...(changes.doc ? { doc: changes.doc } : {}),
      ...(changes.name ? { name: changes.name } : {}),
      revision: sql`${printDesigns.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(printDesigns.id, designId), eq(printDesigns.revision, current.revision)))
    .returning();
  if (!updated) {
    const latest = await getDesign(eventId, designId);
    return latest ? { ok: false, current: latest } : null;
  }

  if (changes.doc) await keepVersion(current, { force: false });
  return { ok: true, design: updated };
}

/**
 * Keeps the state a save replaced, when the newest kept version is older
 * than the interval (or always, for a restore), and trims to the last ten.
 */
async function keepVersion(replaced: PrintDesign, { force }: { force: boolean }): Promise<void> {
  if (!force) {
    const [latest] = await db
      .select({ createdAt: printDesignVersions.createdAt })
      .from(printDesignVersions)
      .where(eq(printDesignVersions.designId, replaced.id))
      .orderBy(desc(printDesignVersions.createdAt))
      .limit(1);
    if (latest && Date.now() - latest.createdAt.getTime() < VERSION_INTERVAL_MS) return;
  }
  await db.insert(printDesignVersions).values({
    id: nanoid(),
    designId: replaced.id,
    revision: replaced.revision,
    doc: replaced.doc,
  });
  const keep = db
    .select({ id: printDesignVersions.id })
    .from(printDesignVersions)
    .where(eq(printDesignVersions.designId, replaced.id))
    .orderBy(desc(printDesignVersions.createdAt), desc(printDesignVersions.revision))
    .limit(MAX_VERSIONS);
  await db
    .delete(printDesignVersions)
    .where(and(eq(printDesignVersions.designId, replaced.id), notInArray(printDesignVersions.id, keep)));
}

export async function listVersions(designId: string) {
  return db
    .select({ id: printDesignVersions.id, revision: printDesignVersions.revision, createdAt: printDesignVersions.createdAt })
    .from(printDesignVersions)
    .where(eq(printDesignVersions.designId, designId))
    .orderBy(desc(printDesignVersions.createdAt), desc(printDesignVersions.revision));
}

/**
 * Puts an earlier version back. What it replaces is kept as a version first,
 * whatever the interval, so a restore is itself undoable.
 */
export async function restoreVersion(eventId: string, designId: string, versionId: string): Promise<PrintDesign | null> {
  const design = await getDesign(eventId, designId);
  if (!design) return null;
  const [version] = await db
    .select()
    .from(printDesignVersions)
    .where(and(eq(printDesignVersions.id, versionId), eq(printDesignVersions.designId, designId)))
    .limit(1);
  if (!version) return null;
  const doc = upgradeDoc(version.doc);
  if (!doc) throw new DesignError(409, "That version could not be read.");
  await keepVersion(design, { force: true });
  const [updated] = await db
    .update(printDesigns)
    .set({ doc, revision: sql`${printDesigns.revision} + 1`, updatedAt: new Date() })
    .where(eq(printDesigns.id, designId))
    .returning();
  return updated ?? null;
}

export async function deleteDesign(eventId: string, designId: string): Promise<boolean> {
  const [removed] = await db
    .delete(printDesigns)
    .where(and(eq(printDesigns.id, designId), eq(printDesigns.eventId, eventId)))
    .returning({ thumbnailKey: printDesigns.thumbnailKey });
  if (!removed) return false;
  if (removed.thumbnailKey) await deleteBlobs([removed.thumbnailKey]);
  return true;
}

/** Stores the list's small picture of a design. Not a new revision. */
export async function storeThumbnail(eventId: string, designId: string, bytes: Uint8Array): Promise<string> {
  const key = thumbnailKey(eventId, designId);
  await r2.send(
    new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: bytes, ContentType: "image/jpeg" }),
  );
  await db
    .update(printDesigns)
    .set({ thumbnailKey: key })
    .where(and(eq(printDesigns.id, designId), eq(printDesigns.eventId, eventId)));
  return key;
}

// --- Assets ---------------------------------------------------------------

export async function listAssets(eventId: string): Promise<PrintAsset[]> {
  return db.select().from(printAssets).where(eq(printAssets.eventId, eventId)).orderBy(desc(printAssets.createdAt));
}

export async function getAsset(eventId: string, assetId: string): Promise<PrintAsset | null> {
  const [row] = await db
    .select()
    .from(printAssets)
    .where(and(eq(printAssets.id, assetId), eq(printAssets.eventId, eventId)))
    .limit(1);
  return row ?? null;
}

/**
 * A place to upload one image: a fresh id and a PUT signed for exactly this
 * type and size, so the slot cannot carry something larger than was checked.
 */
export async function assetUploadSlot(
  eventId: string,
  input: { mimeType: AssetMime; sizeBytes: number },
): Promise<{ assetId: string; uploadUrl: string }> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(printAssets)
    .where(eq(printAssets.eventId, eventId));
  if (count >= MAX_ASSETS_PER_EVENT) {
    throw new DesignError(409, `An event can hold ${MAX_ASSETS_PER_EVENT} uploaded images. Delete some you no longer use.`);
  }
  if (input.sizeBytes > MAX_ASSET_BYTES) throw new DesignError(413, "That image is over 15 MB.");
  const assetId = nanoid();
  const uploadUrl = await getSignedUrl(
    r2,
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: assetKey(eventId, assetId, input.mimeType),
      ContentType: input.mimeType,
      ContentLength: input.sizeBytes,
    }),
    { expiresIn: 5 * 60 },
  );
  return { assetId, uploadUrl };
}

/**
 * Records an upload once its bytes are in storage. The object is asked for its
 * own size and type rather than trusting the browser's word for either.
 */
export async function confirmAsset(input: {
  eventId: string;
  assetId: string;
  mimeType: AssetMime;
  width: number;
  height: number;
  createdBy: string;
}): Promise<PrintAsset> {
  const key = assetKey(input.eventId, input.assetId, input.mimeType);
  const head = await r2
    .send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }))
    .catch(() => null);
  if (!head) throw new DesignError(404, "The image did not finish uploading. Try again.");
  const size = Number(head.ContentLength ?? 0);
  if (size <= 0 || size > MAX_ASSET_BYTES || head.ContentType !== input.mimeType) {
    await deleteBlobs([key]);
    throw new DesignError(400, "That image could not be used.");
  }
  const [row] = await db
    .insert(printAssets)
    .values({
      id: input.assetId,
      eventId: input.eventId,
      key,
      mimeType: input.mimeType,
      width: input.width,
      height: input.height,
      sizeBytes: size,
      createdBy: input.createdBy,
    })
    .onConflictDoNothing()
    .returning();
  return row ?? (await getAsset(input.eventId, input.assetId))!;
}

/** Deletes an image no design draws. One a design draws is refused. */
export async function deleteAsset(eventId: string, assetId: string): Promise<"deleted" | "in_use" | "not_found"> {
  const asset = await getAsset(eventId, assetId);
  if (!asset) return "not_found";
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(printDesigns)
    .where(and(eq(printDesigns.eventId, eventId), sql`${printDesigns.doc}::text LIKE ${`%"${assetId}"%`}`));
  if (count > 0) return "in_use";
  await db.delete(printAssets).where(eq(printAssets.id, assetId));
  await deleteBlobs([asset.key]);
  return "deleted";
}

/**
 * Every stored object a set of events' designs own, deleted. Called wherever
 * an event's other objects are, before its rows go: the rows are the only
 * record of where the objects are.
 */
export async function deleteEventDesignObjects(eventIds: string[]): Promise<number> {
  if (eventIds.length === 0) return 0;
  const [assets, designs] = await Promise.all([
    db.select({ key: printAssets.key }).from(printAssets).where(inArray(printAssets.eventId, eventIds)),
    db.select({ key: printDesigns.thumbnailKey }).from(printDesigns).where(inArray(printDesigns.eventId, eventIds)),
  ]);
  const keys = [...assets.map((row) => row.key), ...designs.flatMap((row) => (row.key ? [row.key] : []))];
  await deleteBlobs(keys);
  return keys.length;
}

// --- What the studio's pages are sent -------------------------------------

/** A design as a browser receives it: plain values, the scene upgraded. */
export interface StudioDesign {
  id: string;
  name: string;
  preset: string;
  widthMm: number;
  heightMm: number;
  bleedMm: number;
  revision: number;
  updatedAt: string;
}

export function toStudioDesign(row: Pick<PrintDesign, keyof StudioDesign | "updatedAt">): StudioDesign {
  return {
    id: row.id,
    name: row.name,
    preset: row.preset,
    widthMm: row.widthMm,
    heightMm: row.heightMm,
    bleedMm: row.bleedMm,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** An image as the studio receives it, with the route that serves its bytes. */
export interface StudioAsset {
  id: string;
  url: string;
  width: number;
  height: number;
  mimeType: string;
}

export function toStudioAsset(eventId: string, asset: PrintAsset): StudioAsset {
  return {
    id: asset.id,
    url: `/api/events/${encodeURIComponent(eventId)}/designs/assets/${encodeURIComponent(asset.id)}`,
    width: asset.width,
    height: asset.height,
    mimeType: asset.mimeType,
  };
}
