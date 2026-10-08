import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq, sql } from "drizzle-orm";

// ACT-1 against a real Postgres carrying the real trigger from 0018. The trigger
// is half of the design (limits and "one pass, one event" live there), so a
// test that mocked it would be testing the other half's hopes.
vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));

const {
  grantEntitlement,
  licenseWithAvailableGrant,
  reconcileLicenses,
  revokeEntitlement,
  getAccountEntitlements,
  hasVenueGrant,
} = await import("@/lib/entitlements");
const { eventLicenseState } = await import("@/lib/license");
const { entitlements, events, users } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeUser, resetDatabase, testDb } = await import("./harness");

const eventRow = async (id: string) => (await testDb.select().from(events).where(eq(events.id, id)))[0];
const grant = (userId: string, planKey: "event" | "premium" | "venue", extra = {}) =>
  grantEntitlement({ userId, planKey, source: "admin", reason: "Paid by card", grantedBy: null, ...extra });

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("a pass", () => {
  it("puts the account's waiting draft live, with the plan's retention from now", async () => {
    const owner = await makeUser({ activatedAt: null });
    const draft = await makeEvent(owner, { retentionUntil: null });

    const result = await grant(owner, "premium");

    expect(result.licensed).toEqual([draft]);
    expect(result.firstActivation).toBe(true);
    const row = await eventRow(draft);
    expect(eventLicenseState(row)).toBe("live");
    expect(row.planKey).toBe("premium");
    const days = (row.retentionUntil!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(364);
    const [account] = await testDb.select().from(users).where(eq(users.id, owner));
    expect(account.activatedAt).not.toBeNull();
  });

  it("waits unused when there is no draft, and the next event spends it", async () => {
    const owner = await makeUser();
    const result = await grant(owner, "event");
    expect(result.licensed).toEqual([]);
    expect((await getAccountEntitlements(owner)).unusedPasses).toHaveLength(1);

    const later = await makeEvent(owner);
    expect(await licenseWithAvailableGrant({ id: later, ownerId: owner })).toMatchObject({ licensed: true });
    expect((await getAccountEntitlements(owner)).unusedPasses).toHaveLength(0);
  });

  /**
   * The revenue leak ACT-1 exists to close: one $39 pass on the account used
   * to mean an event every month for ever.
   */
  it("licenses one event, and a second event stays a draft", async () => {
    const owner = await makeUser();
    await grant(owner, "event");
    const first = await makeEvent(owner);
    const second = await makeEvent(owner);
    expect((await licenseWithAvailableGrant({ id: first, ownerId: owner })).licensed).toBe(true);
    expect((await licenseWithAvailableGrant({ id: second, ownerId: owner })).licensed).toBe(false);
    expect(eventLicenseState(await eventRow(second))).toBe("draft");
  });

  it("cannot be spent twice by two events going live at the same moment", async () => {
    const owner = await makeUser();
    await grant(owner, "event");
    const drafts = await Promise.all(Array.from({ length: 6 }, () => makeEvent(owner)));
    const results = await Promise.all(drafts.map((id) => licenseWithAvailableGrant({ id, ownerId: owner })));
    expect(results.filter((result) => result.licensed)).toHaveLength(1);
  });

  it("is refused by the database when pointed at a second event directly", async () => {
    const owner = await makeUser();
    const first = await makeEvent(owner);
    const { entitlement } = await grant(owner, "event", { applyToEventId: first });
    const second = await makeEvent(owner);
    await expect(
      testDb.update(events).set({ entitlementId: entitlement.id }).where(eq(events.id, second)),
    ).rejects.toThrow();
  });

  it("is refused by the database when pointed at somebody else's event", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const theirs = await makeEvent(stranger);
    const { entitlement } = await grant(owner, "event");
    await expect(
      testDb.update(events).set({ entitlementId: entitlement.id }).where(eq(events.id, theirs)),
    ).rejects.toThrow();
  });

  it("stays spent after its event is purged, so it cannot come back to life", async () => {
    const owner = await makeUser();
    const first = await makeEvent(owner);
    await grant(owner, "event", { applyToEventId: first });
    await testDb.delete(events).where(eq(events.id, first));
    expect((await getAccountEntitlements(owner)).unusedPasses).toHaveLength(0);
  });
});

describe("a Venue grant", () => {
  it("licenses events up to its live limit and leaves the rest as drafts with a reason", async () => {
    const owner = await makeUser();
    await grant(owner, "venue");
    const ids = [];
    for (let index = 0; index < 6; index += 1) ids.push(await makeEvent(owner));
    const results = [];
    for (const id of ids) results.push(await licenseWithAvailableGrant({ id, ownerId: owner }));
    expect(results.filter((result) => result.licensed)).toHaveLength(5);
    const refused = results.find((result) => !result.licensed);
    expect(refused && !refused.licensed && refused.reason).toContain("5 live events");
  });

  it("counts against its limits from the numbers on the grant, not lib/plans.ts", async () => {
    const owner = await makeUser();
    const { entitlement } = await grant(owner, "venue");
    await testDb.update(entitlements).set({ maxActiveEvents: 1 }).where(eq(entitlements.id, entitlement.id));
    const first = await makeEvent(owner);
    const second = await makeEvent(owner);
    expect((await licenseWithAvailableGrant({ id: first, ownerId: owner })).licensed).toBe(true);
    expect((await licenseWithAvailableGrant({ id: second, ownerId: owner })).licensed).toBe(false);
  });

  it("frees a slot when an event is closed", async () => {
    const owner = await makeUser();
    const { entitlement } = await grant(owner, "venue");
    await testDb.update(entitlements).set({ maxActiveEvents: 1 }).where(eq(entitlements.id, entitlement.id));
    const first = await makeEvent(owner);
    await licenseWithAvailableGrant({ id: first, ownerId: owner });
    await testDb.update(events).set({ isActive: false }).where(eq(events.id, first));
    const second = await makeEvent(owner);
    expect((await licenseWithAvailableGrant({ id: second, ownerId: owner })).licensed).toBe(true);
  });

  it("refuses to re-open an event past the live limit", async () => {
    const owner = await makeUser();
    const { entitlement } = await grant(owner, "venue");
    await testDb.update(entitlements).set({ maxActiveEvents: 1 }).where(eq(entitlements.id, entitlement.id));
    const first = await makeEvent(owner);
    await licenseWithAvailableGrant({ id: first, ownerId: owner });
    await testDb.update(events).set({ isActive: false }).where(eq(events.id, first));
    const second = await makeEvent(owner);
    await licenseWithAvailableGrant({ id: second, ownerId: owner });
    await expect(
      testDb.update(events).set({ isActive: true }).where(eq(events.id, first)),
    ).rejects.toThrow();
  });
});

describe("hasVenueGrant", () => {
  it("is true only while a Venue grant is active and current", async () => {
    const owner = await makeUser();
    expect(await hasVenueGrant(owner)).toBe(false);
    await grant(owner, "event");
    expect(await hasVenueGrant(owner)).toBe(false);
    const { entitlement } = await grant(owner, "venue", { endsAt: new Date(Date.now() + 60_000) });
    expect(await hasVenueGrant(owner)).toBe(true);
    await testDb
      .update(entitlements)
      .set({ endsAt: sql`now() - interval '1 minute'` })
      .where(eq(entitlements.id, entitlement.id));
    expect(await hasVenueGrant(owner)).toBe(false);
  });
});

describe("revoking", () => {
  // A real account: who revoked is a foreign key, so a made-up id is refused.
  let admin: { id: string };
  beforeEach(async () => {
    admin = { id: await makeUser({ role: "superadmin" }) };
  });

  it("lapses what it licensed, which stays readable and stops taking uploads", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner);
    const { entitlement } = await grant(owner, "event", { applyToEventId: event });
    const result = await revokeEntitlement(entitlement.id, { by: admin, reason: "Refunded" });
    expect(result).toEqual({ revoked: true, lapsedEvents: 1 });
    expect(eventLicenseState(await eventRow(event))).toBe("lapsed");
  });

  it("makes an unused pass unspendable", async () => {
    const owner = await makeUser();
    const { entitlement } = await grant(owner, "event");
    await revokeEntitlement(entitlement.id, { by: admin, reason: "Chargeback" });
    const draft = await makeEvent(owner);
    expect((await licenseWithAvailableGrant({ id: draft, ownerId: owner })).licensed).toBe(false);
  });

  it("still lets a lapsed event be deleted, which the trigger must not block", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner);
    const { entitlement } = await grant(owner, "event", { applyToEventId: event });
    await revokeEntitlement(entitlement.id, { by: admin, reason: "Refunded" });
    await testDb.update(events).set({ deletedAt: new Date() }).where(eq(events.id, event));
    expect((await eventRow(event)).deletedAt).not.toBeNull();
  });

  it("happens once", async () => {
    const owner = await makeUser();
    const { entitlement } = await grant(owner, "event");
    await revokeEntitlement(entitlement.id, { by: admin, reason: "Refunded" });
    expect((await revokeEntitlement(entitlement.id, { by: admin, reason: "Again" })).revoked).toBe(false);
  });
});

describe("reconcileLicenses", () => {
  it("finishes a pass that was marked spent on an event the event never learned about", async () => {
    const owner = await makeUser();
    const { entitlement } = await grant(owner, "event");
    const event = await makeEvent(owner);
    // The half of a spend that a killed function leaves behind.
    await testDb
      .update(entitlements)
      .set({ appliedAt: new Date(), appliedEventId: event })
      .where(eq(entitlements.id, entitlement.id));
    expect((await reconcileLicenses()).repaired).toBe(1);
    expect(eventLicenseState(await eventRow(event))).toBe("live");
  });

  it("lapses events under a grant whose end date has passed", async () => {
    const owner = await makeUser();
    const event = await makeEvent(owner);
    const { entitlement } = await grant(owner, "venue", {
      applyToEventId: event,
      endsAt: new Date(Date.now() + 60_000),
    });
    await testDb
      .update(entitlements)
      .set({ endsAt: sql`now() - interval '1 minute'` })
      .where(eq(entitlements.id, entitlement.id));
    expect((await reconcileLicenses()).lapsed).toBe(1);
    expect(eventLicenseState(await eventRow(event))).toBe("lapsed");
  });
});

/**
 * The backfill in drizzle/0018 runs once, in production, against real
 * customers. It is read out of the migration file and run here against a
 * fixture shaped like production on 2026-10-08, so what ships is what was
 * tested rather than a copy of it.
 */
describe("the 0018 backfill", () => {
  const migration = readFileSync(resolve(import.meta.dirname, "..", "drizzle", "0018_entitlements.sql"), "utf8");
  const backfill = migration.slice(migration.indexOf("DO $$"), migration.indexOf("END $$;") + "END $$;".length);

  it("gives every account exactly what users.plan_key gave it, and nothing more", async () => {
    const eventUser = await makeUser({ planKey: "event", activatedAt: new Date() });
    const eventUsersEvent = await makeEvent(eventUser);
    const idle = await makeUser({ planKey: "premium", activatedAt: new Date() });
    const venue = await makeUser({ planKey: "venue", activatedAt: new Date() });
    const venueEvents = [await makeEvent(venue), await makeEvent(venue)];
    const unpaid = await makeUser({ planKey: "event", activatedAt: null });
    const unpaidDraft = await makeEvent(unpaid);

    await testDb.execute(sql.raw(backfill));

    expect((await eventRow(eventUsersEvent)).planKey).toBe("event");
    expect(eventLicenseState(await eventRow(eventUsersEvent))).toBe("live");
    expect((await getAccountEntitlements(eventUser)).unusedPasses).toHaveLength(0);

    const idleHeld = await getAccountEntitlements(idle);
    expect(idleHeld.unusedPasses.map((pass) => pass.planKey)).toEqual(["premium"]);

    for (const id of venueEvents) expect((await eventRow(id)).planKey).toBe("venue");
    expect((await getAccountEntitlements(venue)).accountGrants).toHaveLength(1);

    // Never granted anything, so the backfill grants nothing: the default
    // 'event' in users.plan_key is exactly the lie this replaces.
    expect(eventLicenseState(await eventRow(unpaidDraft))).toBe("draft");
    expect((await getAccountEntitlements(unpaid)).all).toHaveLength(0);
  });

  it("does nothing on a second run", async () => {
    const owner = await makeUser({ planKey: "event", activatedAt: new Date() });
    await makeEvent(owner);
    await testDb.execute(sql.raw(backfill));
    await testDb.execute(sql.raw(backfill));
    expect((await getAccountEntitlements(owner)).all).toHaveLength(1);
  });
});
