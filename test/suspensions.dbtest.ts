import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.hoisted(() => {
  process.env.COMPANY_POSTAL_ADDRESS = "Kreativ Vantage, 1 Main St, Austin, TX 78701, USA";
});

let session: { user: { id: string; role: string } } | null = null;
const sendEmail = vi.fn(async (message: { to: string; subject: string; text: string }) => {
  void message;
  return { sent: true as const, id: "msg_1" };
});
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => session }));
vi.mock("@/lib/email", () => ({ isEmailConfigured: () => true, sendEmail }));

const { POST: suspension } = await import("@/app/api/admin/events/[id]/suspension/route");
const { POST: reportAction } = await import("@/app/api/admin/reports/[mediaId]/route");
const { POST: join } = await import("@/app/api/e/[slug]/session/route");
const { loadShareByToken } = await import("@/lib/shares");
const { sendRecaps } = await import("@/lib/job-handlers/recap");
const { auditLog, events, mediaReports } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeGuest, makeMedia, makeShare, makeUser, resetDatabase, testDb } = await import("./harness");

const REASON = "We received a report about content in this gallery and have paused it while we review it.";
const post = (url: string, body: unknown) =>
  new Request(`https://example.test${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const eventRow = async (id: string) => (await testDb.select().from(events).where(eq(events.id, id)))[0];

async function setup() {
  const owner = await makeUser({ email: "host@example.test", name: "Ana" });
  const eventId = await makeEvent(owner, { planKey: "premium", licensedAt: new Date(), name: "Ana's party" });
  const admin = await makeUser({ role: "superadmin" });
  const { slug } = await eventRow(eventId);
  return { owner, eventId, admin, slug };
}

const joinGallery = (slug: string) =>
  join(post("/x", { consent: true }), { params: Promise.resolve({ slug }) });

beforeEach(async () => {
  sendEmail.mockClear();
  session = null;
  await resetDatabase();
});
afterAll(closeDatabase);

describe("ADM-5 pausing a gallery", () => {
  it("is for superadmins, closes every door to guests, tells the organizer, and reopens exactly as it was", async () => {
    const { eventId, admin, slug } = await setup();
    const photo = await makeMedia(eventId);
    const share = await makeShare(eventId, { mediaId: photo });
    const body = { action: "suspend", reason: REASON, note: "Three nudity reports, checked by hand." };

    expect((await suspension(post(`/x`, body), { params: Promise.resolve({ id: eventId }) })).status).toBe(401);
    session = { user: { id: admin, role: "superadmin" } };
    expect((await suspension(post(`/x`, { ...body, reason: "short" }), { params: Promise.resolve({ id: eventId }) })).status).toBe(400);
    expect((await suspension(post(`/x`, body), { params: Promise.resolve({ id: eventId }) })).status).toBe(200);
    expect((await suspension(post(`/x`, body), { params: Promise.resolve({ id: eventId }) })).status).toBe(409);

    const paused = await eventRow(eventId);
    expect(paused.suspendedAt).toBeInstanceOf(Date);
    expect(paused.suspendedReason).toBe(REASON);
    // The organizer reads the reason, never the note.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const email = sendEmail.mock.calls[0][0];
    expect(email.to).toBe("host@example.test");
    expect(email.text).toContain(REASON);
    expect(email.text).not.toContain("checked by hand");
    const [audit] = await testDb.select().from(auditLog).where(eq(auditLog.action, "event.suspended"));
    expect(audit.detail).toContain("checked by hand");

    const refused = await joinGallery(slug);
    expect(refused.status).toBe(403);
    expect((await refused.json()).code).toBe("suspended");
    expect(await loadShareByToken(`tok_${share}`)).toBeNull();

    sendEmail.mockClear();
    expect((await suspension(post(`/x`, { action: "lift", note: "Reviewed, it was fine." }), { params: Promise.resolve({ id: eventId }) })).status).toBe(200);
    expect((await eventRow(eventId)).suspendedAt).toBeNull();
    expect(sendEmail.mock.calls[0][0].subject).toBe("Ana's party is open again");
    expect((await joinGallery(slug)).status).toBe(200);
    expect(await loadShareByToken(`tok_${share}`)).not.toBeNull();
  });

  it("holds the recap while paused", async () => {
    const { eventId } = await setup();
    await testDb.update(events).set({ suspendedAt: new Date(), suspendedReason: REASON }).where(eq(events.id, eventId));
    await makeGuest(eventId, {
      recapEmail: "maya@example.com",
      recapConsent: "recap-2026-10-10:en",
      recapConsentedAt: new Date(),
      recapDueAt: new Date(Date.now() - 1000),
    });
    expect(await sendRecaps({ eventId }, { jobId: "j", attempt: 1, maxAttempts: 5, deadline: Date.now() + 60_000 })).toEqual({
      requeue: { delayMs: 24 * 60 * 60 * 1000 },
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("ADM-5 asking the organizer to look", () => {
  async function reported(eventId: string, overrides: Parameters<typeof makeMedia>[1] = {}, reason: "nudity" | "child_safety" = "nudity") {
    const mediaId = await makeMedia(eventId, overrides);
    await testDb.insert(mediaReports).values({ id: `rep_${mediaId}`, eventId, mediaId, reporterKey: `k_${mediaId}`, reason });
    return mediaId;
  }
  const act = (mediaId: string, action: string) =>
    reportAction(post("/x", { action, note: "Looked at it." }), { params: Promise.resolve({ mediaId }) });

  it("emails the organizer what it was reported for, and keeps the report open", async () => {
    const { eventId, admin } = await setup();
    session = { user: { id: admin, role: "superadmin" } };
    const mediaId = await reported(eventId);
    expect((await act(mediaId, "notify_organizer")).status).toBe(200);

    const email = sendEmail.mock.calls[0][0];
    expect(email.to).toBe("host@example.test");
    expect(email.text).toContain("nudity or sexual content");
    const [report] = await testDb.select().from(mediaReports).where(eq(mediaReports.mediaId, mediaId));
    expect(report.organizerNotifiedAt).toBeInstanceOf(Date);
    expect(report.resolvedAt).toBeNull();
  });

  it("never tells the organizer about a child-safety report", async () => {
    const { eventId, admin } = await setup();
    session = { user: { id: admin, role: "superadmin" } };
    const mediaId = await reported(eventId, { legalHoldAt: new Date(), status: "rejected" }, "child_safety");
    expect((await act(mediaId, "notify_organizer")).status).toBe(409);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
