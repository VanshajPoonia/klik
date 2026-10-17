import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Session } from "next-auth";

/**
 * ACC-8: a link to choose one's own password works once, for seven days, is
 * replaced by a newer one, ends other sessions when used, and is sent only by
 * a superadmin to an account with an address.
 */

let session: Session | null = null;
const mail: Array<{ to: string; text: string }> = [];
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => session }));
vi.mock("@/lib/email", () => ({
  sendEmail: async (message: { to: string; text: string }) => {
    mail.push(message);
    return { sent: true, id: "e1" };
  },
  isEmailConfigured: () => true,
}));

const { createPasswordLink, choosePassword, lookupPasswordLink } = await import("@/lib/password-links");
const { verifyPassword } = await import("@/lib/credentials");
const adminRoute = await import("@/app/api/admin/clients/[userId]/password-link/route");
const setRoute = await import("@/app/api/set-password/route");
const { passwordLinks, users } = await import("@/lib/schema");
const { closeDatabase, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(async () => {
  session = null;
  mail.length = 0;
  await resetDatabase();
});
afterAll(closeDatabase);

const account = async (id: string) => (await testDb.select().from(users).where(eq(users.id, id)))[0];

describe("ACC-8 choosing a password from a link", () => {
  it("sets the password once, ends other sessions, and leaves the link spent", async () => {
    const userId = await makeUser({ username: "dave" });
    const before = await account(userId);
    const { token } = await createPasswordLink(userId, null);
    expect(await lookupPasswordLink(token)).toMatchObject({ state: "valid", username: "dave" });

    expect(await choosePassword(token, "short")).toEqual({ ok: false, reason: "too_short" });
    expect(await choosePassword(token, "correct horse battery")).toEqual({ ok: true, username: "dave" });
    const after = await account(userId);
    expect(await verifyPassword("correct horse battery", after.passwordHash!)).toBe(true);
    expect(after.credentialVersion).toBe(before.credentialVersion + 1);

    expect(await choosePassword(token, "another long password")).toEqual({ ok: false, reason: "used" });
    expect((await lookupPasswordLink(token)).state).toBe("used");
  });

  it("keeps only the newest link working, and none past seven days", async () => {
    const userId = await makeUser();
    const first = await createPasswordLink(userId, null);
    const second = await createPasswordLink(userId, null);
    expect((await lookupPasswordLink(first.token)).state).toBe("used");
    expect((await lookupPasswordLink(second.token)).state).toBe("valid");

    await testDb.update(passwordLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(passwordLinks.userId, userId));
    expect((await lookupPasswordLink(second.token)).state).toBe("expired");
    expect(await choosePassword(second.token, "a perfectly long password")).toEqual({ ok: false, reason: "expired" });
    expect((await lookupPasswordLink("not-a-code")).state).toBe("missing");
  });

  it("refuses a password that is the account's email", async () => {
    const userId = await makeUser({ email: "ana.ruiz@example.test" });
    const { token } = await createPasswordLink(userId, null);
    expect(await choosePassword(token, "ana.ruiz@example.test")).toEqual({ ok: false, reason: "restates_email" });
  });

  it("answers a spent link as gone through the page's route", async () => {
    const userId = await makeUser();
    const { token } = await createPasswordLink(userId, null);
    const post = (password: string) =>
      setRoute.POST(
        new Request("https://klik.test/api/set-password", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.40" },
          body: JSON.stringify({ token, password }),
        }),
      );
    expect((await post("long enough password")).status).toBe(200);
    expect((await post("long enough password")).status).toBe(410);
  });
});

describe("ACC-8 sending the link from /admin", () => {
  const send = (userId: string) =>
    adminRoute.POST(new Request(`https://klik.test/api/admin/clients/${userId}/password-link`, { method: "POST" }), {
      params: Promise.resolve({ userId }),
    });

  it("is for a superadmin, to an account with an address, and the email carries a working link", async () => {
    const withEmail = await makeUser({ email: "client@example.test", username: "client" });
    const withoutEmail = await makeUser({ email: null });
    expect((await send(withEmail)).status).toBe(401);

    session = { user: { id: await makeUser({ role: "superadmin" }), role: "superadmin" }, expires: new Date(Date.now() + 86_400_000).toISOString() } as unknown as Session;
    expect((await send(withoutEmail)).status).toBe(409);
    const response = await send(withEmail);
    expect(response.status).toBe(200);
    expect(mail).toHaveLength(1);
    expect(mail[0].to).toBe("client@example.test");
    expect(mail[0].text).toContain("@client");
    const token = mail[0].text.match(/\/set-password\/([A-Za-z0-9_-]+)/)![1];
    expect((await lookupPasswordLink(token)).state).toBe("valid");
  });
});
