import { NextResponse } from "next/server";
import { findEventBySlug } from "@/lib/slugs";
import { resolveEventViewer } from "@/lib/event-viewer";
import { proofNote } from "@/lib/proofs";

/**
 * MED-10: what a viewer of a watermarked proof is told. Whose it is and how
 * to ask for the clean photo, as the photographer wrote it. Anyone who can
 * open the gallery may read it; it says nothing the watermark does not.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; mediaId: string }> }) {
  const { slug, mediaId } = await params;
  const event = (await findEventBySlug(slug))?.event;
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const viewer = await resolveEventViewer(event);
  if (!viewer.access.allowed || (!viewer.ownerSession && !viewer.guestId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const note = await proofNote(mediaId, event.id);
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(note, { headers: { "Cache-Control": "private, max-age=300" } });
}
