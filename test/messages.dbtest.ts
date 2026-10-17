import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * MSG-1: one conversation per account, unread counted from the thread's read
 * marks, each side emailed once per unread stretch, and an event named only
 * when it is the writer's own.
 */

const session = { user: null as { id: string; role?: string } | null };
const afterTasks: Array<() => Promise<void>> = [];
const sendEmail = vi.fn<(message: { to: string; subject: string }) => Promise<{ sent: true; id: string }>>(async () => ({ sent: true, id: "e1" }));

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => (session.user ? { user: session.user } : null) }));
vi.mock("@/lib/roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/roles")>()),
  requireSuperadmin: async () => (session.user?.role === "superadmin" ? { user: session.user } : null),
}));
vi.mock("@/lib/email", () => ({ sendEmail, isEmailConfigured: () => true }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => Promise<void>) => afterTasks.push(task),
}));

const { POST: write, GET: read } = await import("@/app/api/messages/route");
const { POST: reply, GET: open } = await import("@/app/api/admin/messages/[accountId]/route");
const { listThreads, unreadForAccount, unreadForKlik } = await import("@/lib/messages");
const { supportMessages } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(async () => {
  session.user = null;
  afterTasks.length = 0;
  sendEmail.mockClear();
  process.env.SUPPORT_INBOX_EMAIL = "help@klik.test";
  await resetDatabase();
});
afterAll(closeDatabase);

const json = (url: string, body: unknown) =>
  new Request(`https://example.test${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const runAfter = async () => {
  for (const task of afterTasks.splice(0)) await task();
};

describe("MSG-1 messages", () => {
  it("lets an organizer write, counts it unread for Klik, and emails Klik once per unread stretch", async () => {
    const organizer = await makeUser({ name: "Ana" });
    session.user = { id: organizer };
    expect((await write(json("/api/messages", { body: "Can we go live today?" }))).status).toBe(201);
    await runAfter();
    expect((await write(json("/api/messages", { body: "It is a wedding" }))).status).toBe(201);
    await runAfter();
    expect(await unreadForKlik()).toBe(2);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: "help@klik.test", subject: "New message from Ana" });

    const [thread] = await listThreads();
    expect(thread).toMatchObject({ accountId: organizer, unread: 2, preview: "It is a wedding", lastFromKlik: false });

    // A superadmin opens it: read for all of Klik.
    session.user = { id: await makeUser({ role: "superadmin" }), role: "superadmin" };
    const opened = await open(new Request(`https://example.test/api/admin/messages/${organizer}`), {
      params: Promise.resolve({ accountId: organizer }),
    });
    expect((await opened.json()).messages).toHaveLength(2);
    expect(await unreadForKlik()).toBe(0);

    // The next message after a read is a new stretch, so it is emailed again.
    session.user = { id: organizer };
    await write(json("/api/messages", { body: "Thanks!" }));
    await runAfter();
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("delivers Klik's reply as unread to the organizer, signed Klik, and emails them", async () => {
    const organizer = await makeUser({ email: "ana@example.test" });
    session.user = { id: await makeUser({ role: "superadmin" }), role: "superadmin" };
    const response = await reply(json(`/api/admin/messages/${organizer}`, { body: "You are live." }), {
      params: Promise.resolve({ accountId: organizer }),
    });
    expect(response.status).toBe(201);
    await runAfter();
    expect(await unreadForAccount(organizer)).toBe(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: "ana@example.test", subject: "Klik replied to your message" });

    session.user = { id: organizer };
    const thread = await (await read(new Request("https://example.test/api/messages"))).json();
    expect(thread.messages[0]).toMatchObject({ body: "You are live.", fromKlik: true, authorName: "Klik" });
    expect(await unreadForAccount(organizer)).toBe(0);
  });

  it("names an event only when it is the writer's own", async () => {
    const organizer = await makeUser();
    const theirs = await makeEvent(organizer);
    const someoneElses = await makeEvent(await makeUser());
    session.user = { id: organizer };
    expect((await write(json("/api/messages", { body: "About this one", eventId: theirs }))).status).toBe(201);
    expect((await write(json("/api/messages", { body: "And this", eventId: someoneElses }))).status).toBe(404);
    const rows = await testDb.select().from(supportMessages).where(eq(supportMessages.accountId, organizer));
    expect(rows.map((row) => row.eventId)).toEqual([theirs]);
  });

  it("keeps Klik's side to superadmins, and empty messages out", async () => {
    const organizer = await makeUser();
    session.user = { id: await makeUser() };
    const refused = await reply(json(`/api/admin/messages/${organizer}`, { body: "Pretending to be Klik" }), {
      params: Promise.resolve({ accountId: organizer }),
    });
    expect(refused.status).toBe(401);
    expect((await write(json("/api/messages", { body: "   " }))).status).toBe(400);
  });
});
