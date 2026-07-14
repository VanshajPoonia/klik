import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import https from "node:https";
import sharp from "sharp";
import heicConvert from "heic-convert";
import { put } from "@vercel/blob";
import { db } from "@/lib/db";
import { events, media } from "@/lib/schema";
import { canViewGallery } from "@/lib/access";
import { fetchGalleryMedia } from "@/lib/media";
import {
  verifyGuestSession,
  guestCookieName,
  eventUnlockCookieName,
  verifyEventUnlock,
} from "@/lib/guest";
import { requireOwnerSession } from "@/lib/roles";
import { isAllowedMime, isVideoMime } from "@/lib/storage";

// sharp/heic-convert need native/WASM Node bindings, never the edge runtime.
export const runtime = "nodejs";
export const maxDuration = 60;

const COMPRESS_MAX_DIMENSION = 2560;
const COMPRESS_QUALITY = 80;

const registerSchema = z.object({
  mediaId: z.string().min(1),
  pathname: z.string().min(1),
  blobUrl: z.string().url(),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationS: z.number().positive().optional(),
  contentHash: z.string().optional(),
});

/**
 * Next.js's global fetch() throws "SharedArrayBuffer is not allowed" for
 * these Blob responses in this runtime (a fetch/undici quirk unrelated to
 * this app's code). Node's raw https client sidesteps it entirely.
 */
function fetchBlobBuffer(url: string, redirectsLeft = 3): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          resolve(fetchBlobBuffer(res.headers.location, redirectsLeft - 1));
          return;
        }
        if (status >= 400) {
          res.resume();
          reject(new Error(`Fetch failed with status ${status}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function loadEvent(slug: string) {
  const [event] = await db.select().from(events).where(eq(events.slug, slug)).limit(1);
  return event ?? null;
}

async function getGuestId(eventId: string) {
  const cookieStore = await cookies();
  const guestCookie = cookieStore.get(guestCookieName(eventId))?.value;
  if (!guestCookie) return null;
  const session = await verifyGuestSession(guestCookie);
  if (!session || session.eventId !== eventId) return null;
  return session.guestId;
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await loadEvent(slug);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ownerSession = await requireOwnerSession(event.ownerId);
  const cookieStore = await cookies();
  const unlockCookie = cookieStore.get(eventUnlockCookieName(event.id))?.value;
  const hasUnlockCookie = unlockCookie ? await verifyEventUnlock(unlockCookie, event.id) : false;

  const access = canViewGallery(event, { isOwner: Boolean(ownerSession), hasUnlockCookie });
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason }, { status: 403 });
  }

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 100);
  const cursor = url.searchParams.get("cursor"); // ISO createdAt of the last item seen

  const guestId = await getGuestId(event.id);
  const rows = await fetchGalleryMedia(event.id, { isOwner: Boolean(ownerSession), guestId, cursor, limit });

  return NextResponse.json({
    media: rows,
    nextCursor: rows.length === limit ? rows[rows.length - 1].createdAt.toISOString() : null,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await loadEvent(slug);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const input = parsed.data;
  if (!isAllowedMime(input.mimeType)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  const guestId = await getGuestId(event.id);
  const ownerSession = await requireOwnerSession(event.ownerId);
  if (!ownerSession && !guestId) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const kind = isVideoMime(input.mimeType) ? "video" : "photo";
  let blobUrl = input.blobUrl;
  let sizeBytes = input.sizeBytes;
  let width = input.width;
  let height = input.height;

  if (kind === "photo") {
    try {
      let buffer: Buffer = await fetchBlobBuffer(blobUrl);

      // sharp's bundled libheif can decode AVIF but not HEIC/HEIF (the format
      // iPhones shoot by default), so those need converting to JPEG first.
      if (input.mimeType === "image/heic" || input.mimeType === "image/heif") {
        buffer = await heicConvert({ buffer, format: "JPEG", quality: 1 });
      }

      const compressed = await sharp(buffer)
        .rotate()
        .resize({
          width: COMPRESS_MAX_DIMENSION,
          height: COMPRESS_MAX_DIMENSION,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: COMPRESS_QUALITY, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });

      // sharp's returned buffer triggers the same "SharedArrayBuffer is not
      // allowed" runtime quirk as the raw fetch() responses did when handed
      // straight to put() - a fresh copy avoids it (see fetchBlobBuffer above).
      const freshBuffer = Buffer.from(new Uint8Array(compressed.data));
      const uploaded = await put(input.pathname, freshBuffer, {
        access: "public",
        contentType: "image/jpeg",
        addRandomSuffix: false,
        allowOverwrite: true,
      });

      blobUrl = uploaded.url;
      sizeBytes = compressed.data.byteLength;
      width = compressed.info.width;
      height = compressed.info.height;
    } catch (error) {
      // Compression is a best-effort optimization - fall back to the original upload untouched.
      console.error("Photo compression failed, storing original:", error);
    }
  }

  const [row] = await db
    .insert(media)
    .values({
      id: input.mediaId,
      eventId: event.id,
      guestId: ownerSession ? null : guestId,
      kind,
      status: event.moderation && !ownerSession ? "pending" : "approved",
      blobUrl,
      blobPathname: input.pathname,
      contentHash: input.contentHash ?? null,
      mimeType: input.mimeType,
      sizeBytes,
      width: width ?? null,
      height: height ?? null,
      durationS: input.durationS ?? null,
    })
    .returning();

  return NextResponse.json({ media: row }, { status: 201 });
}
