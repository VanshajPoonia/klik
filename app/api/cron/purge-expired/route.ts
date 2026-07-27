import { NextResponse } from "next/server";
import { eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, media, users } from "@/lib/schema";
import { deleteBlobs } from "@/lib/storage";
import { getPlan, getPlanDeadline } from "@/lib/plans";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const candidates = await db
    .select({
      id: events.id,
      createdAt: events.createdAt,
      planKey: users.planKey,
    })
    .from(events)
    .innerJoin(users, eq(events.ownerId, users.id))
    .where(isNull(events.purgedAt));

  const expired = candidates.filter(({ createdAt, planKey }) => {
    const plan = getPlan(planKey);
    return getPlanDeadline(createdAt, plan.galleryAccessDays) <= now;
  });

  let mediaDeleted = 0;
  const failures: string[] = [];

  for (const event of expired) {
    try {
      const storedMedia = await db
        .select({ pathname: media.blobPathname })
        .from(media)
        .where(eq(media.eventId, event.id));

      await deleteBlobs(storedMedia.map((item) => item.pathname));
      await db.delete(media).where(eq(media.eventId, event.id));
      await db
        .update(events)
        .set({
          coverMediaId: null,
          isActive: false,
          uploadsEnabled: false,
          purgedAt: now,
          updatedAt: now,
        })
        .where(eq(events.id, event.id));

      mediaDeleted += storedMedia.length;
    } catch (error) {
      failures.push(event.id);
      console.error("Could not purge expired event", event.id, error);
    }
  }

  return NextResponse.json({
    eventsPurged: expired.length - failures.length,
    mediaDeleted,
    failures: failures.length,
  });
}
