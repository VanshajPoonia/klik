import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));

const { recordAudit } = await import("@/lib/audit");
const { auditLog } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeUser, resetDatabase, testDb } = await import("./harness");

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("recordAudit", () => {
  it("records who did what, where", async () => {
    const admin = await makeUser({ role: "superadmin", username: "ops" });
    const eventId = await makeEvent(await makeUser());
    await recordAudit({
      actor: { user: { id: admin, username: "ops" } },
      action: "event.deleted",
      targetType: "event",
      targetId: eventId,
      eventId,
    });
    const [row] = await testDb.select().from(auditLog);
    expect(row).toMatchObject({ actorUserId: admin, actorLabel: "ops", action: "event.deleted", eventId });
  });

  it("never throws, even when the write cannot happen", async () => {
    await expect(
      recordAudit({
        actor: { user: { id: "no-such-user" } },
        action: "event.deleted",
        targetType: "event",
      }),
    ).resolves.toBeUndefined();
  });
});
