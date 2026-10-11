import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { resolveEventActor } from "@/lib/roles";
import { consume } from "@/lib/ratelimit";
import { isVisionConfigured } from "@/lib/ai/workers-ai";
import { gallerySearch, searchByScene, searchBySmartFolder, searchByText, smartFolder } from "@/lib/search";
import { isSceneLabel, normalizeQuery } from "@/lib/vision";
import { reportError } from "@/lib/observability";

const noStore = { "Cache-Control": "no-store" };

/**
 * AI-2 and AI-4 on the dashboard. The dashboard already holds every row, so
 * this answers with ids in order, and the grid shows those of its own. The
 * team sees what the dashboard grid sees, hidden photos included.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
  const actor = await resolveEventActor(event.id, event.ownerId);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });

  const viewer = { isManager: true, guestId: null };
  const url = new URL(request.url);
  const q = normalizeQuery(url.searchParams.get("q") ?? "");
  const scene = url.searchParams.get("scene");
  const folderId = url.searchParams.get("folder");
  if (!q && !scene && !folderId) {
    return NextResponse.json(await gallerySearch(event, viewer), { headers: noStore });
  }

  try {
    let rows;
    if (q) {
      if (!isVisionConfigured()) {
        return NextResponse.json({ error: "Search is not available", code: "search_unavailable" }, { status: 503, headers: noStore });
      }
      const gate = await consume(`search:${event.id}:${actor.session.user.id}`, 30, 60);
      if (!gate.allowed) {
        return NextResponse.json({ error: "Too many searches, wait a moment" }, { status: 429, headers: noStore });
      }
      rows = await searchByText(event, viewer, q);
    } else if (scene) {
      if (!isSceneLabel(scene)) return NextResponse.json({ error: "Unknown scene" }, { status: 400, headers: noStore });
      rows = await searchByScene(event, viewer, scene, 2000);
    } else {
      const folder = await smartFolder(event.id, folderId!);
      if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
      rows = await searchBySmartFolder(event, viewer, folder);
    }
    return NextResponse.json({ ids: rows.map((row) => row.id) }, { headers: noStore });
  } catch (error) {
    reportError("search.failed", error, { eventId: event.id });
    return NextResponse.json({ error: "Search did not work this time" }, { status: 502, headers: noStore });
  }
}
