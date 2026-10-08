import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));

const { countGalleryOpen, eventInsights } = await import("@/lib/insights");
const { closeDatabase, makeEvent, makeGuest, makeMedia, makeShare, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("eventInsights", () => {
  it("counts what happened, live media only, with the busiest guests first", async () => {
    const eventId = await makeEvent(await makeUser());
    const maya = await makeGuest(eventId, { displayName: "Maya" });
    const leo = await makeGuest(eventId, { displayName: "Leo" });
    await makeGuest(eventId, { displayName: "Lurker" });
    await makeMedia(eventId, { guestId: maya });
    await makeMedia(eventId, { guestId: maya });
    await makeMedia(eventId, { guestId: leo, kind: "video", mimeType: "video/mp4" });
    await makeMedia(eventId, { guestId: leo, deletedAt: new Date() });
    const photo = await makeMedia(eventId);
    await makeShare(eventId, { mediaId: photo, viewCount: 4 });
    await countGalleryOpen(eventId);
    await countGalleryOpen(eventId);

    const insights = await eventInsights(eventId);
    expect(insights).toMatchObject({
      galleryOpens: 2,
      guestsJoined: 3,
      contributors: 2,
      photos: 3,
      videos: 1,
      shareOpens: 4,
      bucketSize: "hour",
    });
    expect(insights.topContributors).toEqual([
      { name: "Maya", uploads: 2 },
      { name: "Leo", uploads: 1 },
    ]);
  });

  it("buckets by hour with the quiet hours filled, and by day for a long event", async () => {
    const eventId = await makeEvent(await makeUser());
    await makeMedia(eventId, { createdAt: sql`now() - interval '3 hours'` as unknown as Date });
    await makeMedia(eventId);
    const hourly = await eventInsights(eventId);
    expect(hourly.timeline.length).toBeGreaterThanOrEqual(4);
    expect(hourly.timeline.reduce((sum, row) => sum + row.uploads, 0)).toBe(2);

    await makeMedia(eventId, { createdAt: sql`now() - interval '10 days'` as unknown as Date });
    expect((await eventInsights(eventId)).bucketSize).toBe("day");
  });

  it("is all zeros for an event nobody has used", async () => {
    const insights = await eventInsights(await makeEvent(await makeUser()));
    expect(insights).toMatchObject({ galleryOpens: 0, photos: 0, timeline: [], topContributors: [] });
  });
});
