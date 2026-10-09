import { NextResponse } from "next/server";
import { studioAccess } from "@/lib/print-access";
import { MAX_THUMBNAIL_BYTES, getDesign, storeThumbnail } from "@/lib/print-designs";

/**
 * QR-4a: the small picture of a design the list shows, drawn by the browser
 * that edited it (only a browser has its fonts) and sent here as a JPEG.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string; designId: string }> }) {
  const { id, designId } = await params;
  const access = await studioAccess(id);
  if (!access.ok) return access.response;
  if (!(await getDesign(access.event.id, designId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (request.headers.get("content-type") !== "image/jpeg") {
    return NextResponse.json({ error: "Send a JPEG." }, { status: 415 });
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  // JPEG files start FF D8 FF; anything else is not a thumbnail.
  if (bytes.length === 0 || bytes.length > MAX_THUMBNAIL_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return NextResponse.json({ error: "That thumbnail could not be used." }, { status: 400 });
  }
  await storeThumbnail(access.event.id, designId, bytes);
  return NextResponse.json({ stored: true });
}
