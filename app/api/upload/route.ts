import { NextResponse } from "next/server";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { issueSignedToken } from "@vercel/blob";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { canUpload } from "@/lib/access";
import { verifyGuestSession, guestCookieName } from "@/lib/guest";
import { ALLOWED_MEDIA_MIME_TYPES, isAllowedMime, maxBytesForMime } from "@/lib/storage";
import { requireOwnerSession } from "@/lib/roles";

interface UploadClientPayload {
  eventId: string;
  mimeType: string;
}

// This Blob store is connected via Vercel's OIDC-based mechanism (no classic
// BLOB_READ_WRITE_TOKEN). handleUpload()/upload() hard-require that classic
// token with no OIDC fallback in @vercel/blob@2.6.1 - but issueSignedToken()
// (used by the presigned-URL flow below) goes through the same OIDC-aware
// auth resolution as put()/del(), so it works with just BLOB_STORE_ID.
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadPresignedBody;

  try {
    const jsonResponse = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname, clientPayloadRaw) => {
        if (!clientPayloadRaw) throw new Error("Missing upload payload");
        const payload = JSON.parse(clientPayloadRaw) as UploadClientPayload;

        const [event] = await db
          .select()
          .from(events)
          .where(eq(events.id, payload.eventId))
          .limit(1);
        if (!event) throw new Error("Event not found");
        if (!canUpload(event)) throw new Error("Uploads are closed for this event");
        if (!isAllowedMime(payload.mimeType)) throw new Error("Unsupported file type");

        // Guest must hold a valid signed cookie scoped to this event, or be the event owner.
        const cookieStore = await cookies();
        const guestCookie = cookieStore.get(guestCookieName(event.id))?.value;
        const guestSession = guestCookie ? await verifyGuestSession(guestCookie) : null;
        const ownerSession = await requireOwnerSession(event.ownerId);

        if (!ownerSession && (!guestSession || guestSession.eventId !== event.id)) {
          throw new Error("Not authorized to upload to this event");
        }

        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          validUntil: Date.now() + 5 * 60 * 1000,
          allowedContentTypes: [...ALLOWED_MEDIA_MIME_TYPES],
          maximumSizeInBytes: maxBytesForMime(payload.mimeType),
        });

        return { token };
      },
      // No onUploadCompleted: the client calls POST /api/e/[slug]/media right
      // after uploadPresigned() resolves, so the media row doesn't depend on
      // this webhook (which also can't reach localhost in dev).
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 400 },
    );
  }
}
