import { NextResponse } from "next/server";
import { z } from "zod";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, media } from "@/lib/schema";
import { canUpload } from "@/lib/access";
import { getAccountPlan } from "@/lib/account-plans";
import { verifyGuestSession, guestCookieName } from "@/lib/guest";
import {
  blobPathnameFor,
  extensionForMime,
  isAllowedMime,
  maxBytesForMime,
  publicUrlFor,
  r2,
} from "@/lib/storage";
import { requireOwnerSession } from "@/lib/roles";

const requestSchema = z.object({
  eventId: z.string().min(1),
  mediaId: z.string().min(10).max(64).regex(/^[A-Za-z0-9_-]+$/),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const { eventId, mediaId, mimeType, sizeBytes } = parsed.data;

  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  const plan = await getAccountPlan(event.ownerId);
  if (!canUpload(event, plan.uploadWindowDays)) {
    return NextResponse.json({ error: "Uploads are closed for this event" }, { status: 403 });
  }
  if (!isAllowedMime(mimeType)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }
  const maxBytes = maxBytesForMime(mimeType, plan);
  if (sizeBytes > maxBytes) {
    return NextResponse.json(
      { error: `File is too large for the ${plan.name} plan`, maxBytes },
      { status: 413 },
    );
  }

  const [existingMedia] = await db
    .select({ id: media.id })
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.eventId, event.id)))
    .limit(1);
  if (existingMedia) {
    return NextResponse.json({ error: "Upload identifier is already in use" }, { status: 409 });
  }

  // Guest must hold a valid signed cookie scoped to this event, or be the event owner.
  const cookieStore = await cookies();
  const guestCookie = cookieStore.get(guestCookieName(event.id))?.value;
  const guestSession = guestCookie ? await verifyGuestSession(guestCookie) : null;
  const ownerSession = await requireOwnerSession(event.ownerId);

  if (!ownerSession && (!guestSession || guestSession.eventId !== event.id)) {
    return NextResponse.json({ error: "Not authorized to upload to this event" }, { status: 401 });
  }

  const pathname = blobPathnameFor(event.id, mediaId, extensionForMime(mimeType));
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: pathname,
    ContentType: mimeType,
  });
  const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 5 * 60 });

  return NextResponse.json({
    uploadUrl,
    pathname,
    publicUrl: publicUrlFor(pathname),
    maxBytes,
  });
}
