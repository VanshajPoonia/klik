import { after, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, media } from "@/lib/schema";
import { isStreamConfigured, streamWebhookSecret, verifyStreamWebhook } from "@/lib/stream";
import { kickJobRunner } from "@/lib/jobs";
import { log } from "@/lib/observability";

export const runtime = "nodejs";

/**
 * OPS-1: Stream saying a video finished encoding (or failed to). Trusted for
 * nothing but "look now": the transcode job asks Stream for the video itself,
 * so a forged or replayed body can at most make it look early, and the
 * signature keeps strangers from making Klik call Stream on demand.
 */
export async function POST(request: Request) {
  if (!isStreamConfigured()) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const body = await request.text();
  const secret = await streamWebhookSecret();
  if (!secret || !verifyStreamWebhook(secret, request.headers.get("webhook-signature"), body)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }
  let uid: unknown;
  try {
    uid = (JSON.parse(body) as { uid?: unknown }).uid;
  } catch {
    return NextResponse.json({ error: "Not JSON" }, { status: 400 });
  }
  if (typeof uid !== "string") return NextResponse.json({ ok: true });
  const [row] = await db
    .select({ id: media.id })
    .from(media)
    .where(and(eq(media.streamUid, uid), eq(media.streamState, "pending")))
    .limit(1);
  if (!row) return NextResponse.json({ ok: true });
  await db
    .update(jobs)
    .set({ runAfter: new Date() })
    .where(and(eq(jobs.dedupeKey, `transcode:${row.id}`), eq(jobs.status, "queued")));
  after(kickJobRunner);
  log.info("stream.webhook", { mediaId: row.id });
  return NextResponse.json({ ok: true });
}
