import { after, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiEnhancements, jobs } from "@/lib/schema";
import { isReplicateConfigured, verifyWebhook, webhookSecret } from "@/lib/ai/replicate";
import { kickJobRunner } from "@/lib/jobs";
import { log, reportError } from "@/lib/observability";

export const runtime = "nodejs";

/**
 * AI-5: Replicate saying a run finished. Trusted for nothing but "look now":
 * the job asks Replicate for the prediction itself, so a forged or replayed
 * body can at most make it look early. The signature is still checked, so a
 * stranger cannot make Klik call Replicate on demand.
 */
export async function POST(request: Request) {
  if (!isReplicateConfigured()) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const body = await request.text();
  let secret: string;
  try {
    secret = await webhookSecret();
  } catch (error) {
    reportError("enhance.webhook_secret_failed", error);
    return NextResponse.json({ error: "Try again" }, { status: 503 });
  }
  const valid = verifyWebhook(
    secret,
    {
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
    },
    body,
  );
  if (!valid) return NextResponse.json({ error: "Bad signature" }, { status: 401 });

  let predictionId: unknown;
  try {
    predictionId = (JSON.parse(body) as { id?: unknown }).id;
  } catch {
    return NextResponse.json({ error: "Not JSON" }, { status: 400 });
  }
  if (typeof predictionId !== "string") return NextResponse.json({ ok: true });
  const [row] = await db
    .select({ id: aiEnhancements.id })
    .from(aiEnhancements)
    .where(and(eq(aiEnhancements.predictionId, predictionId), eq(aiEnhancements.status, "running")))
    .limit(1);
  if (!row) return NextResponse.json({ ok: true });

  // The job is waiting out its poll delay; bring it forward and start the queue.
  await db
    .update(jobs)
    .set({ runAfter: new Date() })
    .where(and(eq(jobs.dedupeKey, `enhance:${row.id}`), eq(jobs.status, "queued")));
  after(kickJobRunner);
  log.info("enhance.webhook", { enhancementId: row.id });
  return NextResponse.json({ ok: true });
}
