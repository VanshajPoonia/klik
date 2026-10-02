import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

let session: Session | null = null;

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ auth: async () => session }));

const { requireEventCapability, requireEventManagerSession, requireOwnerSession, requireSuperadmin, resolveEventActor } =
  await import("@/lib/roles");
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


/**
 * ORG-1. Before roles existed, every co-host had the owner's powers short of
 * owning the row, so adding a photographer so they could upload also let them
 * rotate the QR code and remove the other co-hosts. These assert the stored
 * role is what actually gates the action, not just what gets displayed.
 */
describe("resolveEventActor", () => {
  it("reports the owner and a superadmin as owner, with no stored row", async () => {
    const owner = await makeUser({ planKey: "premium" });
    const admin = await makeUser({ role: "superadmin" });
    const event = await makeEvent(owner);

    signedInAs(owner);
    expect((await resolveEventActor(event, owner))?.role).toBe("owner");

    signedInAs(admin, "superadmin");
    expect((await resolveEventActor(event, owner))?.role).toBe("owner");
  });

  it.each(["manager", "moderator", "contributor"] as const)(
    "reports a co-host's stored role: %s",
    async (role) => {
      const owner = await makeUser({ planKey: "premium" });
      const coHost = await makeUser();
      const event = await makeEvent(owner);
      await testDb.insert(eventCoHosts).values({ eventId: event, userId: coHost, role });

      signedInAs(coHost);
      expect((await resolveEventActor(event, owner))?.role).toBe(role);
    },
  );

  it("defaults an existing row with no explicit role to manager", async () => {
    const owner = await makeUser({ planKey: "premium" });
    const coHost = await makeUser();
    const event = await makeEvent(owner);
    await testDb.insert(eventCoHosts).values({ eventId: event, userId: coHost });

    signedInAs(coHost);
    expect((await resolveEventActor(event, owner))?.role).toBe("manager");
  });
});

describe("requireEventCapability", () => {
  const asCoHost = async (role: "manager" | "moderator" | "contributor") => {
    const owner = await makeUser({ planKey: "premium" });
    const coHost = await makeUser();
    const event = await makeEvent(owner);
    await testDb.insert(eventCoHosts).values({ eventId: event, userId: coHost, role });
    signedInAs(coHost);
    return { owner, event };
  };

  it("lets a manager change settings and the team", async () => {
    const { owner, event } = await asCoHost("manager");
    expect(await requireEventCapability(event, owner, "event.settings")).not.toBeNull();
    expect(await requireEventCapability(event, owner, "cohosts.manage")).not.toBeNull();
  });

  it("stops a manager deleting or transferring the event", async () => {
    const { owner, event } = await asCoHost("manager");
    expect(await requireEventCapability(event, owner, "event.delete")).toBeNull();
    expect(await requireEventCapability(event, owner, "event.transfer")).toBeNull();
  });

  it("lets a moderator run the gallery but not configure it or promote themselves", async () => {
    const { owner, event } = await asCoHost("moderator");
    expect(await requireEventCapability(event, owner, "media.moderate")).not.toBeNull();
    expect(await requireEventCapability(event, owner, "media.delete")).not.toBeNull();
    expect(await requireEventCapability(event, owner, "event.settings")).toBeNull();
    expect(await requireEventCapability(event, owner, "event.qr")).toBeNull();
    expect(await requireEventCapability(event, owner, "cohosts.manage")).toBeNull();
  });

  it("lets a contributor upload and view, and nothing else", async () => {
    const { owner, event } = await asCoHost("contributor");
    expect(await requireEventCapability(event, owner, "media.upload")).not.toBeNull();
    expect(await requireEventCapability(event, owner, "media.viewPrivate")).not.toBeNull();
    // The point of the role: the photographer cannot remove a guest's photo.
    expect(await requireEventCapability(event, owner, "media.delete")).toBeNull();
    expect(await requireEventCapability(event, owner, "media.moderate")).toBeNull();
    expect(await requireEventCapability(event, owner, "media.exportAll")).toBeNull();
    expect(await requireEventCapability(event, owner, "event.settings")).toBeNull();
  });

  it("refuses every capability once the membership is soft-deleted", async () => {
    const owner = await makeUser({ planKey: "premium" });
    const coHost = await makeUser();
    const event = await makeEvent(owner);
    await testDb
      .insert(eventCoHosts)
      .values({ eventId: event, userId: coHost, role: "manager", deletedAt: new Date() });

    signedInAs(coHost);
    for (const capability of ["media.upload", "media.viewPrivate", "event.settings"] as const) {
      expect(await requireEventCapability(event, owner, capability), capability).toBeNull();
    }
  });

  it("gives the owner everything", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner);
    signedInAs(owner);
    for (const capability of ["event.delete", "event.transfer", "cohosts.manage"] as const) {
      expect(await requireEventCapability(event, owner, capability), capability).not.toBeNull();
    }
  });
});
