import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { SoftwareAuthenticator } from "./fixtures/authenticator";

/**
 * ACC-6: passkeys, against a software authenticator making real signatures.
 * What matters most: a challenge works once, a passkey signs in only to its
 * own account, and one account's ceremony cannot save a passkey onto another.
 */

const session = { user: { id: "" } as { id: string } | null };
const afterTasks: Array<() => Promise<void>> = [];
const sendEmail = vi.fn(async () => ({ sent: true as const, id: "email_1" }));

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => (session.user ? { user: session.user } : null) }));
vi.mock("@/lib/email", () => ({ sendEmail, isEmailConfigured: () => true }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => Promise<void>) => afterTasks.push(task),
}));

const { POST: startCeremony } = await import("@/app/api/passkeys/options/route");
const { GET: listRoute, POST: saveRoute } = await import("@/app/api/passkeys/route");
const { PATCH: renameRoute, DELETE: removeRoute } = await import("@/app/api/passkeys/[id]/route");
const { PASSKEY_CHALLENGE_COOKIE, PASSKEY_LIMIT, authorizePasskey } = await import("@/lib/passkeys");
const { accountTimeline, userPasskeys } = await import("@/lib/schema");
const { closeDatabase, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(async () => {
  session.user = null;
  afterTasks.length = 0;
  sendEmail.mockClear();
  await resetDatabase();
});
afterAll(closeDatabase);

const ORIGIN = "https://example.test";
let ip = 0;

async function start(purpose: "register" | "signin", origin = ORIGIN) {
  const response = await startCeremony(
    new Request(`${origin}/api/passkeys/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `198.51.100.${(ip += 1) % 250}` },
      body: JSON.stringify({ purpose }),
    }),
  );
  const body = (await response.json()) as { options?: { challenge: string }; error?: string };
  const cookie = response.headers
    .getSetCookie()
    .find((line) => line.startsWith(`${PASSKEY_CHALLENGE_COOKIE}=`))
    ?.split(";")[0];
  return { status: response.status, challenge: body.options?.challenge ?? "", cookie: cookie ?? "", body };
}

function save(cookie: string, answer: unknown, name?: string) {
  return saveRoute(
    new Request(`${ORIGIN}/api/passkeys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie, "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" },
      body: JSON.stringify({ response: answer, ...(name ? { name } : {}) }),
    }),
  );
}

function signIn(cookie: string, answer: unknown, origin = ORIGIN) {
  return authorizePasskey(
    JSON.stringify(answer),
    new Request(`${origin}/api/auth/callback/passkey`, {
      method: "POST",
      headers: { cookie, "x-forwarded-for": "203.0.113.50" },
    }),
  );
}

/** A signed-in account with one passkey on a phone. */
async function enrolled(options: { synced?: boolean; counter?: number } = {}) {
  const userId = await makeUser();
  session.user = { id: userId };
  const phone = new SoftwareAuthenticator({ rpId: "example.test", origin: ORIGIN, ...options });
  const { challenge, cookie } = await start("register");
  const saved = await save(cookie, phone.register(challenge));
  expect(saved.status).toBe(201);
  session.user = null;
  return { userId, phone };
}

describe("ACC-6 adding a passkey", () => {
  it("saves a passkey the phone made for this account, names it, records it and tells the owner", async () => {
    const userId = await makeUser({ email: "ana@example.test", name: "Ana" });
    session.user = { id: userId };
    const phone = new SoftwareAuthenticator({ rpId: "example.test", origin: ORIGIN });

    const { status, challenge, cookie } = await start("register");
    expect(status).toBe(200);
    expect(cookie).toMatch(new RegExp(`^${PASSKEY_CHALLENGE_COOKIE}=`));

    const saved = await save(cookie, phone.register(challenge));
    expect(saved.status).toBe(201);
    const { passkey } = (await saved.json()) as { passkey: { id: string; name: string; synced: boolean } };
    expect(passkey).toMatchObject({ id: phone.id, name: "iPhone", synced: true });

    const [row] = await testDb.select().from(userPasskeys).where(eq(userPasskeys.id, phone.id));
    expect(row.userId).toBe(userId);
    expect(row.transports).toEqual(["internal", "hybrid"]);

    const history = await testDb.select().from(accountTimeline).where(eq(accountTimeline.userId, userId));
    expect(history.map((entry) => entry.kind)).toEqual(["passkey_added"]);

    for (const task of afterTasks) await task();
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "ana@example.test", subject: "A passkey was added to your Klik account" }));

    const listed = (await (await listRoute()).json()) as { passkeys: { id: string }[] };
    expect(listed.passkeys.map((entry) => entry.id)).toEqual([phone.id]);
  });

  it("uses a challenge once", async () => {
    const userId = await makeUser();
    session.user = { id: userId };
    const phone = new SoftwareAuthenticator({ rpId: "example.test", origin: ORIGIN });
    const { challenge, cookie } = await start("register");
    const answer = phone.register(challenge);
    expect((await save(cookie, answer)).status).toBe(201);
    expect((await save(cookie, answer)).status).toBe(400);
  });

  it("refuses to save one account's ceremony onto another account", async () => {
    session.user = { id: await makeUser() };
    const { challenge, cookie } = await start("register");
    session.user = { id: await makeUser() };
    const phone = new SoftwareAuthenticator({ rpId: "example.test", origin: ORIGIN });
    expect((await save(cookie, phone.register(challenge))).status).toBe(400);
    expect(await testDb.select().from(userPasskeys)).toHaveLength(0);
  });

  it("refuses an answer made for another site or another challenge", async () => {
    session.user = { id: await makeUser() };
    const phone = new SoftwareAuthenticator({ rpId: "example.test", origin: ORIGIN });

    const first = await start("register");
    expect((await save(first.cookie, phone.register(first.challenge, { origin: "https://klik.example.evil" }))).status).toBe(400);

    const second = await start("register");
    expect((await save(second.cookie, phone.register("bm90LXRoZS1jaGFsbGVuZ2U"))).status).toBe(400);
    expect(await testDb.select().from(userPasskeys)).toHaveLength(0);
  });

  it("refuses to start anywhere but Klik's own address, and without a session", async () => {
    session.user = { id: await makeUser() };
    expect((await start("register", "https://klik-git-branch.vercel.app")).status).toBe(400);
    session.user = null;
    expect((await start("register")).status).toBe(401);
  });

  it(`stops at ${PASSKEY_LIMIT} passkeys`, async () => {
    const userId = await makeUser();
    session.user = { id: userId };
    await testDb.insert(userPasskeys).values(
      Array.from({ length: PASSKEY_LIMIT }, (_, index) => ({
        id: `key${index}`,
        userId,
        publicKey: "AA",
        deviceType: "multiDevice" as const,
        name: `Key ${index}`,
      })),
    );
    const { status, body } = await start("register");
    expect(status).toBe(409);
    expect(body.error).toContain(String(PASSKEY_LIMIT));
  });
});

describe("ACC-6 signing in with a passkey", () => {
  it("signs in to the account the passkey belongs to and records the use", async () => {
    const { userId, phone } = await enrolled();
    const { challenge, cookie } = await start("signin");
    const result = await signIn(cookie, phone.authenticate(challenge, userId));
    expect(result.ok && result.user.id).toBe(userId);
    const [row] = await testDb.select().from(userPasskeys).where(eq(userPasskeys.id, phone.id));
    expect(row.lastUsedAt).not.toBeNull();
  });

  it("does not accept the same answer twice", async () => {
    const { userId, phone } = await enrolled();
    const { challenge, cookie } = await start("signin");
    const answer = phone.authenticate(challenge, userId);
    expect((await signIn(cookie, answer)).ok).toBe(true);
    expect(await signIn(cookie, answer)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses an answer to a different challenge, or with no challenge at all", async () => {
    const { userId, phone } = await enrolled();
    const { cookie } = await start("signin");
    expect(await signIn(cookie, phone.authenticate("c29tZS1vdGhlci1jaGFsbGVuZ2U", userId))).toEqual({ ok: false, reason: "invalid" });
    const fresh = await start("signin");
    expect(await signIn("", phone.authenticate(fresh.challenge, userId))).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a registration ceremony's cookie for a sign-in", async () => {
    const { userId, phone } = await enrolled();
    session.user = { id: userId };
    const { challenge, cookie } = await start("register");
    expect(await signIn(cookie, phone.authenticate(challenge, userId))).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a passkey presented on behalf of another account", async () => {
    const { phone } = await enrolled();
    const other = await makeUser();
    const { challenge, cookie } = await start("signin");
    expect(await signIn(cookie, phone.authenticate(challenge, other))).toEqual({ ok: false, reason: "invalid" });
  });

  it("says a removed passkey is unknown, so the page can ask the phone to forget it", async () => {
    const { userId, phone } = await enrolled();
    session.user = { id: userId };
    expect((await removeRoute(new Request(`${ORIGIN}/api/passkeys/x`), { params: Promise.resolve({ id: phone.id }) })).status).toBe(200);
    session.user = null;
    const { challenge, cookie } = await start("signin");
    expect(await signIn(cookie, phone.authenticate(challenge, userId))).toEqual({ ok: false, reason: "unknown" });
  });

  it("refuses a hardware key whose counter went backwards, which is what a cloned key does", async () => {
    const { userId, phone } = await enrolled({ synced: false, counter: 5 });
    const first = await start("signin");
    expect((await signIn(first.cookie, phone.authenticate(first.challenge, userId))).ok).toBe(true);
    phone.counter = 2;
    const second = await start("signin");
    expect(await signIn(second.cookie, phone.authenticate(second.challenge, userId))).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses anything arriving at another address", async () => {
    const { userId, phone } = await enrolled();
    const { challenge, cookie } = await start("signin");
    expect(await signIn(cookie, phone.authenticate(challenge, userId), "https://klik-git-branch.vercel.app")).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});

describe("ACC-6 managing passkeys", () => {
  it("renames and removes only the signed-in account's own passkeys", async () => {
    const { userId, phone } = await enrolled();
    const params = { params: Promise.resolve({ id: phone.id }) };
    const rename = (name: string) =>
      renameRoute(
        new Request(`${ORIGIN}/api/passkeys/${phone.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        }),
        params,
      );

    session.user = { id: await makeUser() };
    expect((await rename("Mine now")).status).toBe(404);
    expect((await removeRoute(new Request(`${ORIGIN}/api/passkeys/x`), params)).status).toBe(404);

    session.user = { id: userId };
    expect((await rename("   ")).status).toBe(400);
    const renamed = await rename("  Ana's   phone ");
    expect(await renamed.json()).toEqual({ ok: true, name: "Ana's phone" });
    expect((await removeRoute(new Request(`${ORIGIN}/api/passkeys/x`), params)).status).toBe(200);

    const history = await testDb.select().from(accountTimeline).where(eq(accountTimeline.userId, userId));
    expect(history.map((entry) => entry.kind).sort()).toEqual(["passkey_added", "passkey_removed"]);
  });
});
