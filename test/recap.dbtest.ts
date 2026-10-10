import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.hoisted(() => {
  process.env.COMPANY_POSTAL_ADDRESS = "Kreativ Vantage, 1 Main St, Austin, TX 78701, USA";
});

const sendEmail = vi.fn(async (message: { to: string }) => {
  void message;
  return { sent: true as const, id: "msg_1" };
});
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/email", () => ({ isEmailConfigured: () => true, sendEmail }));

const { POST: join } = await import("@/app/api/e/[slug]/session/route");
const { POST: unsubscribe } = await import("@/app/api/unsubscribe/route");
const { GET: recapImage } = await import("@/app/api/recap/[guestId]/[mediaId]/[sig]/route");
const { sendRecaps } = await import("@/lib/job-handlers/recap");
const { emailHash, recapImageSignature, unsubscribeSignature } = await import("@/lib/recap");
const { emailSuppressions, events, guests, jobs, users } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeGuest, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

const HOUR = 60 * 60 * 1000;
const context = () => ({ jobId: "j", attempt: 1, maxAttempts: 5, deadline: Date.now() + 60_000 });
const guest = async (id: string) => (await testDb.select().from(guests).where(eq(guests.id, id)))[0];
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR);

/** A live gallery, quiet for a while, with photos to show. */
async function gallery(overrides: Partial<typeof events.$inferInsert> = {}) {
  const owner = await makeUser();
  const eventId = await makeEvent(owner, {
    planKey: "premium",
    licensedAt: new Date(),
    eventDate: new Date("2026-10-10T00:00:00Z"),
    ...overrides,
  });
  const photos = await Promise.all(
    [0, 1, 2].map((i) =>
      makeMedia(eventId, {
        createdAt: hoursAgo(5 - i),
        analyzedAt: new Date(),
        perceptualHash: ["0f0f0f0f0f0f0f0f", "f0f0f0f0f0f0f0f0", "00ff00ff00ff00ff"][i],
        sharpness: 200 + i,
        brightness: 0.5,
      }),
    ),
  );
  const hidden = await makeMedia(eventId, {
    visibility: "private",
    createdAt: hoursAgo(4),
    analyzedAt: new Date(),
    perceptualHash: "ff00ff00ff00ff00",
    sharpness: 900,
    brightness: 0.5,
    reactionCount: 40,
  });
  const [{ slug }] = await testDb.select({ slug: events.slug }).from(events).where(eq(events.id, eventId));
  return { owner, eventId, slug, photos, hidden };
}

/** A guest who asked, due an hour ago unless told otherwise. */
const asked = (eventId: string, email: string, overrides: Partial<typeof guests.$inferInsert> = {}) =>
  makeGuest(eventId, {
    recapEmail: email,
    recapConsent: "recap-2026-10-10:en",
    recapConsentedAt: hoursAgo(20),
    recapLocale: "en",
    recapDueAt: hoursAgo(1),
    ...overrides,
  });

const joinWith = async (slug: string, body: Record<string, unknown>) =>
  join(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({ consent: true, ...body }),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ slug }) },
  );

beforeEach(async () => {
  sendEmail.mockClear();
  await resetDatabase();
});
afterAll(closeDatabase);

describe("GRW-1 asking for the recap when joining", () => {
  it("keeps an address only with its own tick, lower-cased, and schedules the morning after", async () => {
    const { eventId, slug } = await gallery();
    expect((await joinWith(slug, { recapEmail: "Maya@Example.com", recapConsent: true, timeZone: "America/New_York" })).status).toBe(200);
    expect((await joinWith(slug, { recapEmail: "leo@example.com" })).status).toBe(200);

    const rows = await testDb.select().from(guests).where(eq(guests.eventId, eventId));
    const withAddress = rows.filter((row) => row.recapEmail);
    expect(withAddress.map((row) => row.recapEmail)).toEqual(["maya@example.com"]);
    expect(withAddress[0].recapDueAt?.toISOString()).toBe("2026-10-11T13:00:00.000Z");
    expect(withAddress[0].recapConsent).toBe("recap-2026-10-10:en");

    const [job] = await testDb.select().from(jobs).where(eq(jobs.kind, "recap.send"));
    expect(job.runAfter.toISOString()).toBe("2026-10-11T13:00:00.000Z");
    expect(job.dedupeKey).toBe(`recap:${eventId}`);
  });

  it("refuses an address that is not one, and keeps none where the host said no", async () => {
    const { slug } = await gallery();
    const bad = await joinWith(slug, { recapEmail: "maya@", recapConsent: true });
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe("recap_email_invalid");

    const off = await gallery({ recapEnabled: false });
    expect((await joinWith(off.slug, { recapEmail: "maya@example.com", recapConsent: true })).status).toBe(200);
    const rows = await testDb.select().from(guests).where(eq(guests.eventId, off.eventId));
    expect(rows.every((row) => row.recapEmail === null)).toBe(true);
  });
});

describe("GRW-1 sending", () => {
  it("sends one email per address, only of photos guests can see, then forgets the address", async () => {
    const { eventId, photos, hidden, owner } = await gallery();
    const phone = await asked(eventId, "maya@example.com");
    const laptop = await asked(eventId, "maya@example.com");
    const later = await asked(eventId, "leo@example.com", { recapDueAt: new Date(Date.now() + 5 * HOUR) });

    const outcome = await sendRecaps({ eventId }, context());

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const message = sendEmail.mock.calls[0][0] as unknown as { to: string; html: string; headers: Record<string, string> };
    expect(message.to).toBe("maya@example.com");
    for (const id of photos) expect(message.html).toContain(`/${id}/`);
    expect(message.html).not.toContain(hidden);
    expect(message.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const [{ code }] = await testDb.select({ code: users.referralCode }).from(users).where(eq(users.id, owner));
    expect(message.html).toContain(`/r/${code}`);

    for (const id of [phone, laptop]) {
      const row = await guest(id);
      expect(row.recapEmail).toBeNull();
      expect(row.recapSentAt).toBeInstanceOf(Date);
    }
    expect((await guest(later)).recapEmail).toBe("leo@example.com");
    // Comes back for Leo when his falls due.
    const delay = (outcome as { requeue: { delayMs: number } }).requeue.delayMs;
    expect(delay).toBeGreaterThan(4.9 * HOUR);
    expect(delay).toBeLessThanOrEqual(5 * HOUR);
  });

  it("never sends to an address that asked to stop, and lets go of it", async () => {
    const { eventId } = await gallery();
    const id = await asked(eventId, "maya@example.com");
    await testDb.insert(emailSuppressions).values({ emailHash: emailHash("maya@example.com"), reason: "unsubscribed" });
    await sendRecaps({ eventId }, context());
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await guest(id)).recapEmail).toBeNull();
  });

  it("lets every request go when the host turns it off", async () => {
    const { eventId } = await gallery();
    const id = await asked(eventId, "maya@example.com");
    await testDb.update(events).set({ recapEnabled: false }).where(eq(events.id, eventId));
    expect(await sendRecaps({ eventId }, context())).toBeUndefined();
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await guest(id)).recapEmail).toBeNull();
  });

  it("waits while the party is still going", async () => {
    const { eventId } = await gallery();
    await asked(eventId, "maya@example.com");
    await makeMedia(eventId, { createdAt: new Date() });
    expect(await sendRecaps({ eventId }, context())).toEqual({ requeue: { delayMs: 2 * HOUR } });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("tries a failed send again later, and lets go after three", async () => {
    const { eventId } = await gallery();
    const id = await asked(eventId, "maya@example.com");
    sendEmail.mockResolvedValue({ sent: false, reason: "rejected" } as never);
    await sendRecaps({ eventId }, context());
    const once = await guest(id);
    expect(once.recapFailures).toBe(1);
    expect(once.recapDueAt!.getTime()).toBeGreaterThan(Date.now() + 5 * HOUR);

    await testDb.update(guests).set({ recapFailures: 2, recapDueAt: hoursAgo(1) }).where(eq(guests.id, id));
    await sendRecaps({ eventId }, context());
    expect((await guest(id)).recapEmail).toBeNull();
    sendEmail.mockResolvedValue({ sent: true, id: "msg_1" });
  });
});

describe("GRW-1 unsubscribing", () => {
  const post = (hash: string, signature: string, accept = "*/*") =>
    unsubscribe(new Request(`https://example.test/api/unsubscribe?e=${hash}&s=${signature}`, { method: "POST", headers: { accept } }));

  it("records the hash, releases a waiting request, and refuses a forged link", async () => {
    const { eventId } = await gallery();
    const id = await asked(eventId, "maya@example.com", { recapDueAt: new Date(Date.now() + HOUR) });
    const hash = emailHash("maya@example.com");

    expect((await post(hash, "forged")).status).toBe(400);
    expect((await post(emailHash("leo@example.com"), unsubscribeSignature(hash))).status).toBe(400);

    const fromPage = await post(hash, unsubscribeSignature(hash), "text/html");
    expect(fromPage.status).toBe(303);
    expect(fromPage.headers.get("location")).toContain("/unsubscribe?done=1");
    expect(await testDb.select().from(emailSuppressions)).toHaveLength(1);
    expect((await guest(id)).recapEmail).toBeNull();
    // Mail apps' one-click button, again: still fine.
    expect((await post(hash, unsubscribeSignature(hash))).status).toBe(200);
  });
});

describe("GRW-1 the photos in the email", () => {
  const load = (guestId: string, mediaId: string, signature = recapImageSignature(guestId, mediaId)) =>
    recapImage(new Request("https://example.test/x"), { params: Promise.resolve({ guestId, mediaId, sig: signature }) });

  it("shows a photo guests can see, and stops once it is hidden", async () => {
    const { eventId, photos, hidden } = await gallery();
    const id = await asked(eventId, "maya@example.com");
    const shown = await load(id, photos[0]);
    expect(shown.status).toBe(302);
    expect(shown.headers.get("location")).toContain("klik-media-test");
    expect(shown.headers.get("cache-control")).toBe("private, no-store");

    expect((await load(id, hidden)).status).toBe(404);
    expect((await load(id, photos[0], recapImageSignature("someone-else", photos[0]))).status).toBe(404);
    const other = await gallery();
    const stranger = await asked(other.eventId, "leo@example.com");
    expect((await load(stranger, photos[0])).status).toBe(404);
  });
});
