import { NextResponse } from "next/server";
import { findEventBySlug } from "@/lib/slugs";
import { resolveEventViewer } from "@/lib/event-viewer";
import { toGalleryMedia } from "@/lib/gallery-media";
import { reactorFor, withViewerReactions } from "@/lib/reactions";
import { clientIp, consume } from "@/lib/ratelimit";
import { isVisionConfigured } from "@/lib/ai/workers-ai";
import { gallerySearch, searchByScene, searchBySmartFolder, searchByText, smartFolder } from "@/lib/search";
import { isSceneLabel, normalizeQuery } from "@/lib/vision";
import { reportError } from "@/lib/observability";

const noStore = { "Cache-Control": "no-store" };

/**
 * AI-2 and AI-4 in the gallery: `?q=` searches by meaning, `?scene=` lists one
 * scene, `?folder=` opens a smart folder, and nothing at all answers what the
 * gallery can offer (whether it is searchable, its scenes and smart folders).
 *
 * The same viewer rules as the grid: a joined guest or the event's team, never
 * a kiosk, and every result passes the grid's own visibility filter.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = await findEventBySlug(slug);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
  const { event } = found;

  const viewer = await resolveEventViewer(event);
  if (!viewer.access.allowed) {
    return NextResponse.json({ error: viewer.access.reason }, { status: 403, headers: noStore });
  }
  if (!viewer.ownerSession && !viewer.guestId) {
    return NextResponse.json({ error: "Join the gallery first" }, { status: 401, headers: noStore });
  }
  if (viewer.kioskId) return NextResponse.json({ error: "Not on a kiosk" }, { status: 403, headers: noStore });

  const isManager = Boolean(viewer.ownerSession);
  if (!isManager && !event.scenesEnabled) {
    return NextResponse.json({ error: "Search is off for this gallery", code: "search_off" }, { status: 403, headers: noStore });
  }
  const mediaViewer = { isManager, guestId: viewer.guestId };
  const url = new URL(request.url);
  const q = normalizeQuery(url.searchParams.get("q") ?? "");
  const scene = url.searchParams.get("scene");
  const folderId = url.searchParams.get("folder");

  if (!q && !scene && !folderId) {
    return NextResponse.json(await gallerySearch(event, mediaViewer), { headers: noStore });
  }

  try {
    let rows;
    if (q) {
      if (!isVisionConfigured()) {
        return NextResponse.json({ error: "Search is not available", code: "search_unavailable" }, { status: 503, headers: noStore });
      }
      // Each new search costs an embedding, so a phone cannot type a thousand.
      const who = viewer.ownerSession?.user?.id ?? viewer.guestId ?? clientIp(request);
      const gate = await consume(`search:${event.id}:${who}`, 30, 60);
      if (!gate.allowed) {
        return NextResponse.json({ error: "Too many searches, wait a moment", code: "rate_limited" }, { status: 429, headers: noStore });
      }
      rows = await searchByText(event, mediaViewer, q);
    } else if (scene) {
      if (!isSceneLabel(scene)) return NextResponse.json({ error: "Unknown scene" }, { status: 400, headers: noStore });
      rows = await searchByScene(event, mediaViewer, scene);
    } else {
      const folder = await smartFolder(event.id, folderId!);
      if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
      rows = await searchBySmartFolder(event, mediaViewer, folder);
    }
    const reactor = reactorFor({ guestId: viewer.guestId, userId: viewer.ownerSession?.user?.id ?? null });
    return NextResponse.json(
      { media: await withViewerReactions(await toGalleryMedia(rows, event.slug), event, reactor) },
      { headers: noStore },
    );
  } catch (error) {
    reportError("search.failed", error, { eventId: event.id });
    return NextResponse.json({ error: "Search did not work this time", code: "search_failed" }, { status: 502, headers: noStore });
  }
}
