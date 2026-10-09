import { NextResponse } from "next/server";
import { z } from "zod";
import { studioAccess } from "@/lib/print-access";
import { ASSET_MIME_TYPES, DesignError, MAX_ASSET_BYTES, assetUploadSlot, listAssets, toStudioAsset } from "@/lib/print-designs";
import { clientIp, consume } from "@/lib/ratelimit";

/**
 * QR-4c: the photos and logos uploaded for an event's designs. POST hands out
 * one signed upload slot; the browser PUTs the bytes straight to storage and
 * then confirms at `/assets/[assetId]`, the same two steps as a gallery upload.
 */

const UPLOADS_PER_HOUR = 60;

const slotSchema = z.object({
  mimeType: z.enum(ASSET_MIME_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_ASSET_BYTES),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await studioAccess(id);
  if (!access.ok) return access.response;
  const assets = await listAssets(access.event.id);
  return NextResponse.json({ assets: assets.map((asset) => toStudioAsset(access.event.id, asset)) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await studioAccess(id);
  if (!access.ok) return access.response;

  const parsed = slotSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Upload a JPEG, PNG or WebP image of 15 MB or less." }, { status: 400 });
  }
  const limit = await consume(`design:asset:${access.event.id}:${clientIp(request)}`, UPLOADS_PER_HOUR, 3600);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many uploads just now. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  try {
    return NextResponse.json(await assetUploadSlot(access.event.id, parsed.data), { status: 201 });
  } catch (error) {
    if (error instanceof DesignError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
