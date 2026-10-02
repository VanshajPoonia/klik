import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

let session: Session | null = null;

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => session }));

const { requireEventManagerSession, requireOwnerSession, requireSuperadmin } = await import(
  "@/lib/roles"
);
const { eventCoHosts } = await import("@/lib/schema");
const { closeDatabase, daysFromNow, makeEvent, makeUser, resetDatabase, testDb } = await import(
  "./harness"
);

const signedInAs = (id: string, role: "organizer" | "superadmin" = "organizer") => {
  session = { user: { id, role }, expires: daysFromNow(30).toISOString() } as unknown as Session;
};

beforeEach(async () => {
  session = null;
  await resetDatabase();
});

afterAll(closeDatabase);

/**
 * `requireEventManagerSession` is the only query in the codebase allowed to
 * read `event_co_hosts` for an authorization decision, and the revocation rule
 * lives inside it as two predicates. That makes it the highest-consequence
 * query here: every other soft-delete filter that gets missed shows stale
 * data, and a missed filter on this one hands a removed co-host the keys back.
 *
 * It cannot be tested without a database, because the predicates *are* the
 * behaviour. Mocking the query would assert that a mock returns what it was
 * told to.
 */
describe("requireEventManagerSession", () => {
  it("lets the owner in", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner);
    signedInAs(owner);
    expect(await requireEventManagerSession(event, owner)).not.toBeNull();
  });

  it("lets a superadmin in without any membership row", async () => {
    const owner = await makeUser();
    const admin = await makeUser({ role: "superadmin" });
    const event = await makeEvent(owner);
    signedInAs(admin, "superadmin");
    expect(await requireEventManagerSession(event, owner)).not.toBeNull();
  });

  it("lets an active co-host in", async () => {
    const owner = await makeUser({ planKey: "premium" });
    const coHost = await makeUser();
    const event = await makeEvent(owner);
    await testDb.insert(eventCoHosts).values({ eventId: event, userId: coHost });

    signedInAs(coHost);
    expect(await requireEventManagerSession(event, owner)).not.toBeNull();
  });

  /** The revocation rule. A removed co-host keeps their row for 30 days so the
   *  removal is reversible, which is exactly why this predicate is load-bearing. */
  it("refuses a co-host whose membership was soft-deleted", async () => {
    const owner = await makeUser({ planKey: "premium" });
    const coHost = await makeUser();
    const event = await makeEvent(owner);
    await testDb
      .insert(eventCoHosts)
      .values({ eventId: event, userId: coHost, deletedAt: new Date() });

    signedInAs(coHost);
    expect(await requireEventManagerSession(event, owner)).toBeNull();
  });

  /** Co-hosting is a Premium capability, enforced here rather than only in the
   *  UI, so a downgrade actually removes the access it paid for. */
  it("refuses a co-host when the owner is no longer on Premium", async () => {
    // "event" is the entry plan. There is no "free" key, which the type checker
    // caught when this test first guessed one.
    const owner = await makeUser({ planKey: "event" });
    const coHost = await makeUser();
    const event = await makeEvent(owner);
    await testDb.insert(eventCoHosts).values({ eventId: event, userId: coHost });

    signedInAs(coHost);
    expect(await requireEventManagerSession(event, owner)).toBeNull();
  });

  it("refuses a co-host of a different event", async () => {
    const owner = await makeUser({ planKey: "premium" });
    const coHost = await makeUser();
    const theirs = await makeEvent(owner);
    const other = await makeEvent(owner);
    await testDb.insert(eventCoHosts).values({ eventId: theirs, userId: coHost });

    signedInAs(coHost);
    expect(await requireEventManagerSession(other, owner)).toBeNull();
  });

  it("refuses a signed-in stranger and a signed-out visitor", async () => {
    const owner = await makeUser({ planKey: "premium" });
    const stranger = await makeUser();
    const event = await makeEvent(owner);

    signedInAs(stranger);
    expect(await requireEventManagerSession(event, owner)).toBeNull();

    session = null;
    expect(await requireEventManagerSession(event, owner)).toBeNull();
  });

  /**
   * Re-adding someone who was removed has to work. The membership row has a
   * composite primary key, so a plain insert would violate it and the removal
   * would be permanent in practice.
   */
  it("lets a removed co-host be restored", async () => {
    const owner = await makeUser({ planKey: "premium" });
    const coHost = await makeUser();
    const event = await makeEvent(owner);

    await testDb
      .insert(eventCoHosts)
      .values({ eventId: event, userId: coHost, deletedAt: new Date() });

    await testDb
      .insert(eventCoHosts)
      .values({ eventId: event, userId: coHost })
      .onConflictDoUpdate({
        target: [eventCoHosts.eventId, eventCoHosts.userId],
        set: { deletedAt: null },
      });

    signedInAs(coHost);
    expect(await requireEventManagerSession(event, owner)).not.toBeNull();
  });
});

describe("requireOwnerSession", () => {
  it("admits the owner and a superadmin, and refuses everyone else", async () => {
    const owner = await makeUser();
    const admin = await makeUser({ role: "superadmin" });
    const stranger = await makeUser();

    signedInAs(owner);
    expect(await requireOwnerSession(owner)).not.toBeNull();

    signedInAs(admin, "superadmin");
    expect(await requireOwnerSession(owner)).not.toBeNull();

    // A co-host is explicitly not an owner. This is the boundary that keeps
    // ownership transfer and deletion away from collaborators.
    signedInAs(stranger);
    expect(await requireOwnerSession(owner)).toBeNull();

    session = null;
    expect(await requireOwnerSession(owner)).toBeNull();
  });
});

describe("requireSuperadmin", () => {
  it("admits only a superadmin", async () => {
    const admin = await makeUser({ role: "superadmin" });
    const organizer = await makeUser();

    signedInAs(admin, "superadmin");
    expect(await requireSuperadmin()).not.toBeNull();

    signedInAs(organizer);
    expect(await requireSuperadmin()).toBeNull();

    session = null;
    expect(await requireSuperadmin()).toBeNull();
  });
});
