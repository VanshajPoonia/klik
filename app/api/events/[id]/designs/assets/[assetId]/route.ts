import { NextResponse } from "next/server";
import { z } from "zod";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2 } from "@/lib/storage";
import { studioAccess } from "@/lib/print-access";
import {
  ASSET_MIME_TYPES,
  DesignError,
  MAX_ASSET_PIXELS,
  confirmAsset,
  deleteAsset,
  getAsset,
  toStudioAsset,
} from "@/lib/print-designs";

/**
 * One uploaded image: its bytes for the studio (GET), recording it once its
 * upload has landed (POST), and deleting it when no design draws it (DELETE).
 */

const confirmSchema = z.object({
  mimeType: z.enum(ASSET_MIME_TYPES),
  width: z.number().int().min(1).max(MAX_ASSET_PIXELS),
  height: z.number().int().min(1).max(MAX_ASSET_PIXELS),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id, assetId } = await params;
  const access = await studioAccess(id);
  if (!access.ok) return access.response;
  const asset = await getAsset(access.event.id, assetId);
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = await getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: asset.key, ResponseContentType: asset.mimeType }),
    { expiresIn: 10 * 60 },
  );
  return NextResponse.redirect(url, { status: 307, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id, assetId } = await params;
  const access = await studioAccess(id);
  if (!access.ok) return access.response;
  const parsed = confirmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !/^[A-Za-z0-9_-]{10,40}$/.test(assetId)) {
    return NextResponse.json({ error: "That image could not be used." }, { status: 400 });
  }
  try {
    const asset = await confirmAsset({
      eventId: access.event.id,
      assetId,
      ...parsed.data,
      createdBy: access.actor.session.user.id,
    });
    return NextResponse.json({ asset: toStudioAsset(access.event.id, asset) }, { status: 201 });
  } catch (error) {
    if (error instanceof DesignError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id, assetId } = await params;
  const access = await studioAccess(id);
  if (!access.ok) return access.response;
  const outcome = await deleteAsset(access.event.id, assetId);
  if (outcome === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (outcome === "in_use") {
    return NextResponse.json({ error: "A design still uses this image. Remove it from the design first." }, { status: 409 });
  }
  return NextResponse.json({ deleted: true });
}
