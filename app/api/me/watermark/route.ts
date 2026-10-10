import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { watermarks } from "@/lib/schema";
import { deleteBlobs, r2 } from "@/lib/storage";
import { consume } from "@/lib/ratelimit";
import { watermarkProfile } from "@/lib/proofs";
import { reportError } from "@/lib/observability";
import {
  WATERMARK_LIMITS,
  normalizeBuyUrl,
  watermarkSettingsSchema,
} from "@/lib/watermark-settings";

// sharp checks and re-encodes every image here.
export const runtime = "nodejs";

/**
 * MED-10: the signed-in account's watermark for proofs. The stamp is drawn by
 * the browser, where the fonts are, and only checked and re-encoded here; the
 * logo it was drawn with is kept beside it so it can be drawn again later.
 * Objects live under `watermarks/<userId>/`, which the orphan reaper does not
 * walk; this route and account erasure are what delete them.
 */

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ watermark: await watermarkProfile(session.user.id) }, { headers: { "Cache-Control": "no-store" } });
}

/** Checks and re-encodes an uploaded image, so only bytes made here are stored. */
async function cleanPng(file: File, maxBytes: number, maxSide: number, fit: "refuse" | "shrink") {
  if (file.size === 0 || file.size > maxBytes) return null;
  const sharp = (await import("sharp")).default;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const meta = await sharp(input).metadata();
    if (!meta.width || !meta.height || !["png", "jpeg", "webp"].includes(meta.format ?? "")) return null;
    if (fit === "refuse" && (meta.format !== "png" || meta.width > maxSide || meta.height > maxSide || meta.width < 40 || meta.height < 10)) {
      return null;
    }
    const { data, info } = await sharp(input)
      .rotate()
      .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

async function store(key: string, data: Buffer) {
  await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: data, ContentType: "image/png" }));
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const limit = await consume(`watermark:save:${userId}`, 30, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many saves. Try again later." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }

  const form = await request.formData().catch(() => null);
  let raw: unknown = null;
  try {
    raw = JSON.parse(String(form?.get("settings") ?? ""));
  } catch {
    // Reported below as invalid input.
  }
  const parsed = watermarkSettingsSchema.safeParse(raw);
  if (!form || !parsed.success) {
    return NextResponse.json({ error: parsed.success ? "Invalid input" : (parsed.error.issues[0]?.message ?? "Invalid input") }, { status: 400 });
  }
  const settings = parsed.data;
  const buyUrl = normalizeBuyUrl(settings.buyUrl);
  if (!buyUrl.ok) {
    return NextResponse.json({ error: "The link must be a web address starting https://, or an email address." }, { status: 400 });
  }

  const [existing] = await db.select().from(watermarks).where(eq(watermarks.userId, userId)).limit(1);
  const stampFile = form.get("stamp");
  const logoFile = form.get("logo");
  if (!(stampFile instanceof File) && !existing) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const stamp = stampFile instanceof File ? await cleanPng(stampFile, WATERMARK_LIMITS.stampBytes, WATERMARK_LIMITS.stampMaxSide, "refuse") : null;
  if (stampFile instanceof File && !stamp) return NextResponse.json({ error: "The watermark image could not be read." }, { status: 400 });
  const logo =
    settings.logo === "replace" && logoFile instanceof File
      ? await cleanPng(logoFile, WATERMARK_LIMITS.logoBytes, WATERMARK_LIMITS.logoMaxSide, "shrink")
      : null;
  if (settings.logo === "replace" && !logo) {
    return NextResponse.json({ error: "That logo could not be read. Use a PNG, JPEG or WebP." }, { status: 400 });
  }

  const stampKey = stamp ? `watermarks/${userId}/${nanoid()}.png` : existing!.stampKey;
  const logoKey =
    settings.logo === "replace" ? `watermarks/${userId}/logo-${nanoid()}.png` : settings.logo === "remove" ? null : (existing?.logoKey ?? null);
  try {
    if (stamp) await store(stampKey, stamp.data);
    if (logo && logoKey) await store(logoKey, logo.data);
  } catch (error) {
    reportError("watermark.store_failed", error, { userId });
    return NextResponse.json({ error: "Could not save your watermark. Try again." }, { status: 500 });
  }

  const values = {
    stampKey,
    stampWidth: stamp?.width ?? existing!.stampWidth,
    stampHeight: stamp?.height ?? existing!.stampHeight,
    logoKey,
    label: settings.label,
    font: settings.font,
    position: settings.position,
    opacity: settings.opacity,
    scale: settings.scale,
    buyNote: settings.buyNote?.trim() || null,
    buyUrl: buyUrl.url,
    updatedAt: new Date(),
  };
  await db.insert(watermarks).values({ userId, ...values }).onConflictDoUpdate({ target: watermarks.userId, set: values });

  // Old objects only once nothing names them. Proofs already stamped keep
  // their watermark; a new stamp applies to proofs uploaded from now on.
  const stale = [
    ...(existing && existing.stampKey !== stampKey ? [existing.stampKey] : []),
    ...(existing?.logoKey && existing.logoKey !== logoKey ? [existing.logoKey] : []),
  ];
  await deleteBlobs(stale).catch((error) => reportError("watermark.cleanup_failed", error, { userId }));

  return NextResponse.json({ watermark: await watermarkProfile(userId) });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [removed] = await db
    .delete(watermarks)
    .where(eq(watermarks.userId, session.user.id))
    .returning({ stampKey: watermarks.stampKey, logoKey: watermarks.logoKey });
  if (removed) {
    await deleteBlobs([removed.stampKey, ...(removed.logoKey ? [removed.logoKey] : [])]).catch((error) =>
      reportError("watermark.cleanup_failed", error, { userId: session.user!.id }),
    );
  }
  return NextResponse.json({ ok: true });
}
