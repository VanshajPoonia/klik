import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Session } from "next-auth";

/**
 * MED-14: a link for particular people opens for the event's team and for the
 * accounts it was sent to, through the one gate every share surface uses, and
 * for nobody else holding the URL.
 */

let session: Session | null = null;
const sent: Array<{ to: string; text: string; bulk: boolean }> = [];
let mailWorks = true;
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => session }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/email", () => ({
  sendEmail: async (message: { to: string; text: string }, options: { bulk?: boolean } = {}) => {
    if (!mailWorks) return { sent: false, reason: "daily_limit" };
    sent.push({ to: message.to, text: message.text, bulk: Boolean(options.bulk) });
    return { sent: true, id: "e1" };
  },
  isEmailConfigured: () => true,
}));

const { resolveShareRequest } = await import("@/lib/share-request");
const { inviteToShare, listInvites, openToAnyone, parseInviteEmails, removeInvite, MAX_INVITES_PER_LINK } = await import("@/lib/share-invites");
const hostRoute = await import("@/app/api/events/[id]/shares/[shareId]/invites/route");
const { mediaShares, shareInvites } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeMedia, makeShare, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(async () => {
  session = null;
  sent.length = 0;
  mailWorks = true;
  await resetDatabase();
});
afterAll(closeDatabase);

const signIn = (id: string, role = "organizer") => {
  session = { user: { id, role }, expires: new Date(Date.now() + 86_400_000).toISOString() } as unknown as Session;
};

async function setUp() {
  const owner = await makeUser();
  const eventId = await makeEvent(owner);
  const mediaId = await makeMedia(eventId);
  const shareId = await makeShare(eventId, { mediaId, inviteOnly: true });
  const [share] = await testDb.select().from(mediaShares).where(eq(mediaShares.id, shareId));
  return { owner, eventId, share };
}

/** The code in the invite email's link. */
function codeFrom(text: string): string {
  const match = text.match(/\?invite=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error("no invite link in the email");
  return match[1];
}

describe("parseInviteEmails", () => {
  it("reads commas, new lines and names, lower-cases, de-duplicates, and names what it could not read", () => {
    expect(parseInviteEmails("Ana Ruiz <Ana@Example.com>, bo@example.com\nbo@example.com; not-an@address")).toEqual({
      valid: ["ana@example.com", "bo@example.com"],
      invalid: ["not-an@address"],
    });
    expect(parseInviteEmails(["a@b.co", " A@B.CO "]).valid).toEqual(["a@b.co"]);
  });
});

describe("MED-14 the gate", () => {
  it("asks a signed-out person to sign in, and refuses an account it was not sent to", async () => {
    const { share } = await setUp();
    expect(await resolveShareRequest(share.token)).toMatchObject({ ok: false, reason: "sign_in" });
    signIn(await makeUser());
    expect(await resolveShareRequest(share.token)).toMatchObject({ ok: false, reason: "not_invited" });
  });

  it("opens for the invited address with the email's code, and for that account from then on", async () => {
    const { owner, eventId, share } = await setUp();
    await inviteToShare({ share, event: { id: eventId, name: "Ana & Bo" }, emails: ["guest@example.test"], invitedBy: { userId: owner }, inviterName: "Ana", what: "a photo" });
    const code = codeFrom(sent[0].text);
    const invited = await makeUser({ email: "Guest@Example.test" });
    signIn(invited);

    // The bare link is not enough for an address nobody has proved.
    expect(await resolveShareRequest(share.token)).toMatchObject({ ok: false, reason: "not_invited" });
    expect(await resolveShareRequest(share.token, { inviteCode: "not-the-code" })).toMatchObject({ ok: false, reason: "not_invited" });
    expect((await resolveShareRequest(share.token, { inviteCode: code })).ok).toBe(true);
    const [row] = await testDb.select().from(shareInvites).where(eq(shareInvites.shareId, share.id));
    expect(row.userId).toBe(invited);
    expect(row.openedAt).not.toBeNull();
    expect((await resolveShareRequest(share.token)).ok).toBe(true);

    // The code is spent on that account: someone forwarded the email gets nothing from it.
    signIn(await makeUser({ email: "forwarded@example.test" }));
    expect(await resolveShareRequest(share.token, { inviteCode: code })).toMatchObject({ ok: false, reason: "not_invited" });

    // Taken off the link, the account is refused again.
    await removeInvite(share.id, row.id);
    signIn(invited);
    expect(await resolveShareRequest(share.token)).toMatchObject({ ok: false, reason: "not_invited" });
  });

  it("opens without the code for an address proved by a sign-in code, which is how an unsent invite still works", async () => {
    const { owner, eventId, share } = await setUp();
    mailWorks = false;
    const result = await inviteToShare({ share, event: { id: eventId, name: "E" }, emails: ["proved@example.test"], invitedBy: { userId: owner }, inviterName: "Ana", what: "a photo" });
    expect(result).toMatchObject({ sent: [], unsent: ["proved@example.test"] });
    expect((await listInvites(share.id))[0]).toMatchObject({ emailed: false, opened: false });
    signIn(await makeUser({ email: "proved@example.test", emailVerified: new Date() }));
    expect((await resolveShareRequest(share.token)).ok).toBe(true);
  });

  it("opens for the team, says a turned-off link is off before asking who anyone is, and opens to anyone once handed back", async () => {
    const { owner, share } = await setUp();
    signIn(owner);
    expect((await resolveShareRequest(share.token)).ok).toBe(true);
    signIn(await makeUser(), "superadmin");
    expect((await resolveShareRequest(share.token)).ok).toBe(true);

    session = null;
    await openToAnyone(share.id);
    expect((await resolveShareRequest(share.token)).ok).toBe(true);
    await testDb.update(mediaShares).set({ inviteOnly: true, revokedAt: new Date() }).where(eq(mediaShares.id, share.id));
    expect(await resolveShareRequest(share.token)).toMatchObject({ ok: false, reason: "revoked" });
  });

  it("leaves an ordinary link open to anyone holding it", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner);
    const shareId = await makeShare(eventId, { mediaId: await makeMedia(eventId) });
    const [share] = await testDb.select().from(mediaShares).where(eq(mediaShares.id, shareId));
    expect((await resolveShareRequest(share.token)).ok).toBe(true);
  });
});

describe("MED-14 inviting", () => {
  it("makes the link invite-only, sends each address its own code as bulk mail, and skips who is already on it", async () => {
    const owner = await makeUser();
    const eventId = await makeEvent(owner);
    const shareId = await makeShare(eventId, { mediaId: await makeMedia(eventId) });
    const [share] = await testDb.select().from(mediaShares).where(eq(mediaShares.id, shareId));

    const first = await inviteToShare({ share, event: { id: eventId, name: "Ana & Bo" }, emails: ["a@example.test", "b@example.test"], invitedBy: { userId: owner }, inviterName: "Ana", what: "a photo" });
    expect(first.sent).toEqual(["a@example.test", "b@example.test"]);
    expect(sent.every((mail) => mail.bulk)).toBe(true);
    expect(codeFrom(sent[0].text)).not.toBe(codeFrom(sent[1].text));
    expect(sent[0].text).toContain("Ana shared a photo with you");
    const [after] = await testDb.select().from(mediaShares).where(eq(mediaShares.id, shareId));
    expect(after.inviteOnly).toBe(true);
    // Only the hash is kept.
    const rows = await testDb.select().from(shareInvites).where(eq(shareInvites.shareId, shareId));
    expect(rows.map((row) => row.tokenHash)).not.toContain(codeFrom(sent[0].text));

    const again = await inviteToShare({ share: after, event: { id: eventId, name: "E" }, emails: ["a@example.test"], invitedBy: { userId: owner }, inviterName: "Ana", what: "a photo" });
    expect(again).toMatchObject({ sent: [], already: ["a@example.test"] });
  });

  it("stops at the most one link is for", async () => {
    const { owner, eventId, share } = await setUp();
    const many = Array.from({ length: MAX_INVITES_PER_LINK + 2 }, (_, index) => `p${index}@example.test`);
    const result = await inviteToShare({ share, event: { id: eventId, name: "E" }, emails: many, invitedBy: { userId: owner }, inviterName: "Ana", what: "a photo" });
    expect(result.sent).toHaveLength(MAX_INVITES_PER_LINK);
    expect(result.full).toHaveLength(2);
  });

  it("takes invitations only from the event's team, through the host's route", async () => {
    const { owner, eventId, share } = await setUp();
    const call = (method: string, body?: unknown) =>
      hostRoute[method as "POST"](
        new Request(`https://klik.test/api/events/${eventId}/shares/${share.id}/invites`, {
          method,
          headers: { "content-type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        }),
        { params: Promise.resolve({ id: eventId, shareId: share.id }) },
      );
    signIn(await makeUser());
    expect((await call("POST", { emails: "x@example.test" })).status).toBe(401);

    signIn(owner);
    const response = await call("POST", { emails: "x@example.test, nope@" });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.share).toMatchObject({ inviteOnly: true, inviteCount: 1 });
    expect(data.invites).toEqual([expect.objectContaining({ email: "x@example.test", emailed: true, opened: false })]);
    expect(data.invalid).toEqual(["nope@"]);
    expect(JSON.stringify(data)).not.toContain("tokenHash");

    const opened = await call("PATCH", { inviteOnly: false });
    expect((await opened.json()).share.inviteOnly).toBe(false);
  });
});
