import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { and, eq, isNull } from "drizzle-orm";

let session: Session | null = null;
const sendEmail = vi.fn(async (message: { to: string; html?: string; text?: string }) => {
  void message;
  return { sent: true };
});

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => session }));
vi.mock("@/lib/email", () => ({ sendEmail, isEmailConfigured: () => true }));

const { POST: addCoHost } = await import("@/app/api/events/[id]/co-hosts/route");
const { DELETE: removeCoHost } = await import("@/app/api/events/[id]/co-hosts/[userId]/route");
const { DELETE: withdrawInvite } = await import("@/app/api/events/[id]/invites/[inviteId]/route");
const { POST: acceptInviteRoute } = await import("@/app/api/invites/[token]/route");
const { POST: offer, DELETE: withdrawOffer } = await import("@/app/api/events/[id]/transfer/route");
const { POST: acceptOffer } = await import("@/app/api/events/[id]/transfer/accept/route");
const { eventActivity } = await import("@/lib/activity");
const { hashInviteToken, openInvites } = await import("@/lib/team");
const { eventCoHosts, eventInvites, events, media } = await import("@/lib/schema");
const { closeDatabase, daysFromNow, makeEvent, makeMedia, makeUser, resetDatabase, testDb } = await import(
  "./harness"
);

const signedInAs = (id: string) => {
  session = { user: { id, role: "organizer", name: id }, expires: daysFromNow(30).toISOString() } as unknown as Session;
};

const json = (body: unknown) =>
  new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const bare = (method = "POST") => new Request("http://localhost/x", { method });
const eventParams = (id: string) => ({ params: Promise.resolve({ id }) });

/** The token is only ever in the email, so the tests read it from there too. */
function tokenFromLastEmail(): string {
  const message = sendEmail.mock.calls.at(-1)?.[0];
  const body = `${message?.html ?? ""} ${message?.text ?? ""}`;
  const match = /\/invite\/([A-Za-z0-9_-]+)/.exec(body);
  if (!match) throw new Error("No invitation link in the last email");
  return match[1];
}

async function invite(eventId: string, email: string, role = "moderator") {
  return addCoHost(json({ identifier: email, role }), eventParams(eventId));
}

async function membership(eventId: string, userId: string) {
  const [row] = await testDb
    .select()
    .from(eventCoHosts)
    .where(and(eq(eventCoHosts.eventId, eventId), eq(eventCoHosts.userId, userId), isNull(eventCoHosts.deletedAt)));
  return row ?? null;
}

beforeEach(async () => {
  session = null;
  sendEmail.mockClear();
  await resetDatabase();
});

afterAll(closeDatabase);

describe("ORG-3 invitations", () => {
  it("invites an address with no account, storing only a hash of the link", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner, { planKey: "premium" });
    signedInAs(owner);

    const response = await invite(eventId, "New.Person@Example.test");
    expect(response.status).toBe(201);
    const token = tokenFromLastEmail();
    expect(sendEmail.mock.calls.at(-1)?.[0].to).toBe("new.person@example.test");

    const [row] = await testDb.select().from(eventInvites).where(eq(eventInvites.eventId, eventId));
    expect(row.email).toBe("new.person@example.test");
    expect(row.tokenHash).toBe(hashInviteToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("adds an existing account directly, matching its email without case", async () => {
    const owner = await makeUser();
    const friend = await makeUser({ email: "ana@example.test" });
    const eventId = await makeEvent(owner, { planKey: "premium" });
    signedInAs(owner);

    const response = await invite(eventId, "ANA@example.test", "manager");
    expect(response.status).toBe(201);
    expect((await response.json()).coHost.id).toBe(friend);
    expect(await membership(eventId, friend)).not.toBeNull();
    expect(await openInvites(eventId)).toHaveLength(0);
  });

  it("joins the invited account with the invited role, once", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner, { planKey: "premium" });
    signedInAs(owner);
    await invite(eventId, "new@example.test", "contributor");
    const token = tokenFromLastEmail();

    const joiner = await makeUser({ email: "new@example.test" });
    signedInAs(joiner);
    const first = await acceptInviteRoute(bare(), { params: Promise.resolve({ token }) });
    expect(first.status).toBe(200);
    expect((await membership(eventId, joiner))?.role).toBe("contributor");

    const again = await acceptInviteRoute(bare(), { params: Promise.resolve({ token }) });
    expect(again.status).toBe(409);
  });

  it("refuses an invitation to anyone signed in with another address", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner, { planKey: "premium" });
    signedInAs(owner);
    await invite(eventId, "intended@example.test");
    const token = tokenFromLastEmail();

    const forwardedTo = await makeUser({ email: "someone-else@example.test" });
    signedInAs(forwardedTo);
    const response = await acceptInviteRoute(bare(), { params: Promise.resolve({ token }) });
    expect(response.status).toBe(409);
    expect(await membership(eventId, forwardedTo)).toBeNull();
  });

  it("replaces the link when an address is invited again, so the old one stops working", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner, { planKey: "premium" });
    signedInAs(owner);
    await invite(eventId, "twice@example.test");
    const oldToken = tokenFromLastEmail();
    await invite(eventId, "twice@example.test");
    const newToken = tokenFromLastEmail();
    expect(newToken).not.toBe(oldToken);
    expect(await openInvites(eventId)).toHaveLength(1);

    const joiner = await makeUser({ email: "twice@example.test" });
    signedInAs(joiner);
    expect((await acceptInviteRoute(bare(), { params: Promise.resolve({ token: oldToken }) })).status).toBe(409);
    expect((await acceptInviteRoute(bare(), { params: Promise.resolve({ token: newToken }) })).status).toBe(200);
  });

  it("counts open invitations against the plan's co-host limit", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner, { planKey: "premium" });
    signedInAs(owner);
    for (let i = 0; i < 5; i += 1) {
      expect((await invite(eventId, `guest${i}@example.test`)).status).toBe(201);
    }
    expect((await invite(eventId, "sixth@example.test")).status).toBe(409);
    const existing = await makeUser({ email: "existing@example.test" });
    expect((await invite(eventId, "existing@example.test")).status).toBe(409);
    expect(await membership(eventId, existing)).toBeNull();
    // Re-sending to an address already invited is not a new seat.
    expect((await invite(eventId, "guest0@example.test")).status).toBe(201);
  });

  it("withdraws an invitation so its link stops working", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner, { planKey: "premium" });
    signedInAs(owner);
    const created = await (await invite(eventId, "gone@example.test")).json();
    const token = tokenFromLastEmail();
    const response = await withdrawInvite(bare("DELETE"), {
      params: Promise.resolve({ id: eventId, inviteId: created.invite.id }),
    });
    expect(response.status).toBe(200);

    signedInAs(await makeUser({ email: "gone@example.test" }));
    expect((await acceptInviteRoute(bare(), { params: Promise.resolve({ token }) })).status).toBe(409);
  });

  it("does not let a moderator invite anyone", async () => {
    const owner = await makeUser();
    const moderator = await makeUser();
    const eventId = await makeEvent(owner, { planKey: "premium" });
    await testDb.insert(eventCoHosts).values({ eventId, userId: moderator, role: "moderator" });
    signedInAs(moderator);
    expect((await invite(eventId, "x@example.test")).status).toBe(401);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("ORG-4 handing an event over", () => {
  async function setup() {
    const owner = await makeUser();
    const manager = await makeUser();
    const eventId = await makeEvent(owner, { planKey: "premium" });
    await testDb.insert(eventCoHosts).values({ eventId, userId: manager, role: "manager" });
    return { owner, manager, eventId };
  }

  const ownerOf = async (eventId: string) =>
    (await testDb.select({ ownerId: events.ownerId }).from(events).where(eq(events.id, eventId)))[0].ownerId;

  it("moves ownership only when the recipient accepts, and keeps the old owner as a manager", async () => {
    const { owner, manager, eventId } = await setup();
    signedInAs(owner);
    expect((await offer(json({ toUserId: manager }), eventParams(eventId))).status).toBe(200);
    expect(await ownerOf(eventId)).toBe(owner);

    signedInAs(manager);
    expect((await acceptOffer(bare(), eventParams(eventId))).status).toBe(200);
    expect(await ownerOf(eventId)).toBe(manager);
    expect(await membership(eventId, manager)).toBeNull();
    expect((await membership(eventId, owner))?.role).toBe("manager");

    // Done once. Pressing it again finds no offer.
    expect((await acceptOffer(bare(), eventParams(eventId))).status).toBe(404);
  });

  it("only offers an event to a manager on its team", async () => {
    const { owner, eventId } = await setup();
    const moderator = await makeUser();
    await testDb.insert(eventCoHosts).values({ eventId, userId: moderator, role: "moderator" });
    const stranger = await makeUser();
    signedInAs(owner);
    expect((await offer(json({ toUserId: moderator }), eventParams(eventId))).status).toBe(409);
    expect((await offer(json({ toUserId: stranger }), eventParams(eventId))).status).toBe(409);
  });

  it("lets nobody but the recipient accept", async () => {
    const { owner, manager, eventId } = await setup();
    const otherManager = await makeUser();
    await testDb.insert(eventCoHosts).values({ eventId, userId: otherManager, role: "manager" });
    signedInAs(owner);
    await offer(json({ toUserId: manager }), eventParams(eventId));

    signedInAs(otherManager);
    expect((await acceptOffer(bare(), eventParams(eventId))).status).toBe(404);
    expect(await ownerOf(eventId)).toBe(owner);
  });

  it("does not let a manager offer the event themselves", async () => {
    const { manager, eventId } = await setup();
    const otherManager = await makeUser();
    await testDb.insert(eventCoHosts).values({ eventId, userId: otherManager, role: "manager" });
    signedInAs(manager);
    expect((await offer(json({ toUserId: otherManager }), eventParams(eventId))).status).toBe(401);
  });

  it("withdraws the offer when the recipient is removed from the team", async () => {
    const { owner, manager, eventId } = await setup();
    signedInAs(owner);
    await offer(json({ toUserId: manager }), eventParams(eventId));
    await removeCoHost(bare("DELETE"), { params: Promise.resolve({ id: eventId, userId: manager }) });

    signedInAs(manager);
    expect((await acceptOffer(bare(), eventParams(eventId))).status).toBe(404);
    expect(await ownerOf(eventId)).toBe(owner);
  });

  it("will not complete for a recipient demoted after the offer", async () => {
    const { owner, manager, eventId } = await setup();
    signedInAs(owner);
    await offer(json({ toUserId: manager }), eventParams(eventId));
    // Demoted behind the route's back, as a race would: the accept itself checks.
    await testDb.update(eventCoHosts).set({ role: "moderator" }).where(eq(eventCoHosts.userId, manager));

    signedInAs(manager);
    expect((await acceptOffer(bare(), eventParams(eventId))).status).toBe(409);
    expect(await ownerOf(eventId)).toBe(owner);
  });

  it("lets the recipient decline", async () => {
    const { owner, manager, eventId } = await setup();
    signedInAs(owner);
    await offer(json({ toUserId: manager }), eventParams(eventId));
    signedInAs(manager);
    expect((await withdrawOffer(bare("DELETE"), eventParams(eventId))).status).toBe(200);
    const [row] = await testDb.select().from(events).where(eq(events.id, eventId));
    expect(row.transferToUserId).toBeNull();
  });

  it("refuses while a photo in the event is under a legal hold", async () => {
    const { owner, manager, eventId } = await setup();
    const photo = await makeMedia(eventId);
    await testDb.update(media).set({ legalHoldAt: new Date() }).where(eq(media.id, photo));
    signedInAs(owner);
    expect((await offer(json({ toUserId: manager }), eventParams(eventId))).status).toBe(409);
  });

  it("keeps the event on the licence the old owner paid for", async () => {
    const { owner, manager, eventId } = await setup();
    await testDb.update(events).set({ entitlementId: null, licensedAt: new Date() }).where(eq(events.id, eventId));
    signedInAs(owner);
    await offer(json({ toUserId: manager }), eventParams(eventId));
    signedInAs(manager);
    await acceptOffer(bare(), eventParams(eventId));
    const [row] = await testDb.select().from(events).where(eq(events.id, eventId));
    expect(row.planKey).toBe("premium");
    expect(row.licensedAt).not.toBeNull();
  });
});

describe("eventActivity", () => {
  it("tells the team what the team did, and names Klik for anything else", async () => {
    const owner = await makeUser({ username: "host" });
    const friend = await makeUser({ email: "friend@example.test", name: "Friend" });
    const eventId = await makeEvent(owner, { planKey: "premium" });
    signedInAs(owner);
    await invite(eventId, "friend@example.test", "manager");

    const { recordAudit } = await import("@/lib/audit");
    const admin = await makeUser({ role: "superadmin", username: "staff" });
    await recordAudit({
      actor: { user: { id: admin, username: "staff" } },
      action: "event.went_live",
      targetType: "event",
      targetId: eventId,
      eventId,
    });
    await recordAudit({
      actor: { user: { id: admin, username: "staff" } },
      action: "report.resolved",
      targetType: "media",
      eventId,
      detail: "Removed. Internal note.",
    });

    const entries = await eventActivity(eventId);
    expect(entries.map((entry) => `${entry.who} ${entry.what}`)).toEqual([
      "Klik put the event live",
      `${owner} added Friend as manager`,
    ]);
    expect(JSON.stringify(entries)).not.toContain("Internal note");
    expect(JSON.stringify(entries)).not.toContain("staff");
    void friend;
  });
});
