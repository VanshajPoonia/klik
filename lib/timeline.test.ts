import { describe, expect, it } from "vitest";
import { resolveChain, type ChainInput, type TimelineFact } from "./timeline";

/**
 * The chain is what a superadmin reads to decide who to deal with next, so the
 * thing under test is not really the labels. It is whether `action` appears on
 * exactly the steps somebody has to do something about, because a board where
 * everything incomplete looks urgent gets ignored, and one that hides a stuck
 * customer is worse than no board.
 */

const SIGNED_UP = new Date("2026-10-01T09:00:00Z");
const ACTIVATED = new Date("2026-10-02T11:30:00Z");

function account(overrides: Partial<ChainInput> = {}): ChainInput {
  return {
    userId: "u1",
    email: "buyer@example.test",
    createdAt: SIGNED_UP,
    activatedAt: null,
    activationEmailSentAt: null,
    planName: "Klik Event",
    ...overrides,
  };
}

const NOTHING = new Map<string, TimelineFact>();
function facts(entries: Record<string, Partial<TimelineFact>>): Map<string, TimelineFact> {
  return new Map(
    Object.entries(entries).map(([kind, fact]) => [
      kind,
      { detail: null, actorLabel: null, createdAt: SIGNED_UP, ...fact },
    ]),
  );
}

const counts = (eventCount = 0, mediaCount = 0) => ({ eventCount, mediaCount });
const step = (steps: ReturnType<typeof resolveChain>, key: string) => {
  const found = steps.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`no step ${key}`);
  return found;
};

describe("resolveChain", () => {
  it("always returns the same seven steps in the same order", () => {
    const keys = resolveChain(account(), counts(), NOTHING).map((s) => s.key);
    expect(keys).toEqual([
      "signed_up",
      "welcome_email",
      "payment",
      "plan_assigned",
      "access_email",
      "event_created",
      "guests_uploading",
    ]);
    // Completed steps are not dropped: the list has to be scannable down a page
    // of accounts, which it cannot be if its length changes per card.
    const activated = resolveChain(
      account({ activatedAt: ACTIVATED, activationEmailSentAt: ACTIVATED }),
      counts(2, 40),
      facts({ welcome_email_sent: {}, plan_assigned: {} }),
    );
    expect(activated).toHaveLength(7);
  });

  describe("a fresh signup nobody has touched", () => {
    const steps = resolveChain(account(), counts(), facts({ welcome_email_sent: {} }));

    /**
     * The two things a superadmin has to do, and nothing else. Marking the
     * customer's own steps as needing attention is what makes the panel noise.
     */
    it("asks for the payment check and the plan, and nothing more", () => {
      expect(steps.filter((s) => s.state === "action").map((s) => s.key)).toEqual([
        "payment",
        "plan_assigned",
      ]);
    });

    it("tells you what to search Stripe for, since Klik cannot see the payment", () => {
      expect(step(steps, "payment").note).toContain("buyer@example.test");
      expect(step(steps, "payment").note).toContain("tells Klik nothing");
    });

    it("does not ask anyone to send the access email by hand", () => {
      const accessEmail = step(steps, "access_email");
      expect(accessEmail.state).toBe("waiting");
      expect(accessEmail.note).toContain("Sends itself");
    });

    it("explains that the event is blocked rather than merely absent", () => {
      expect(step(steps, "event_created").note).toContain("Unlocks when you activate");
    });
  });

  describe("once a plan is assigned", () => {
    const steps = resolveChain(
      account({ activatedAt: ACTIVATED, activationEmailSentAt: ACTIVATED }),
      counts(1, 0),
      facts({
        welcome_email_sent: {},
        plan_assigned: { actorLabel: "vanshaj", detail: "Activated on Klik Event." },
      }),
    );

    /**
     * Assigning the plan IS the payment confirmation: a human found it in Stripe
     * before clicking. Leaving this as an open action would ask them to redo a
     * check they have already done, on every account, forever.
     */
    it("counts the payment as confirmed, and says who by", () => {
      expect(step(steps, "payment").state).toBe("done");
      expect(step(steps, "plan_assigned").note).toContain("vanshaj");
      expect(step(steps, "plan_assigned").note).toContain("Klik Event");
    });

    it("leaves nothing needing attention", () => {
      expect(steps.filter((s) => s.state === "action")).toHaveLength(0);
    });

    it("waits on the customer for uploads without implying a problem", () => {
      const uploading = step(steps, "guests_uploading");
      expect(uploading.state).toBe("waiting");
      expect(uploading.note).toContain("Normal until the day");
    });
  });

  /**
   * The case this whole chain exists for. Activated, so they can work, but never
   * told, so they do not know. Nothing in the old UI distinguished this from a
   * healthy account, and the customer is sitting waiting for an email.
   */
  it("flags an account that was activated and never notified", () => {
    const steps = resolveChain(
      account({ activatedAt: ACTIVATED, activationEmailSentAt: null }),
      counts(),
      facts({ welcome_email_sent: {}, plan_assigned: {} }),
    );
    const accessEmail = step(steps, "access_email");
    expect(accessEmail.state).toBe("action");
    expect(accessEmail.note).toContain("never notified");
  });

  it("says to phone an activated account that has no address to mail", () => {
    const steps = resolveChain(
      account({ email: null, activatedAt: ACTIVATED }),
      counts(),
      NOTHING,
    );
    expect(step(steps, "access_email").note).toContain("Call them");
    expect(step(steps, "signed_up").note).toContain("No email address");
  });

  it("surfaces a refused welcome email instead of losing it", () => {
    const steps = resolveChain(
      account(),
      counts(),
      facts({ welcome_email_failed: { detail: "The provider refused the send." } }),
    );
    const welcome = step(steps, "welcome_email");
    expect(welcome.state).toBe("action");
    expect(welcome.note).toContain("refused");
  });

  /**
   * Absent history is ambiguous: either nothing was sent, or the account is
   * older than the log. Rendering it as "not sent" would be a guess that gets
   * acted on, so it has its own state.
   */
  it("admits when there is simply no record rather than guessing", () => {
    const welcome = step(resolveChain(account(), counts(), NOTHING), "welcome_email");
    expect(welcome.state).toBe("unknown");
    expect(welcome.note).toContain("No record");
  });

  it("reports the latest plan change, not just the original grant", () => {
    const steps = resolveChain(
      account({ activatedAt: ACTIVATED }),
      counts(1, 5),
      facts({
        plan_assigned: { actorLabel: "vanshaj" },
        plan_changed: { detail: "Changed from Klik Event to Klik Premium.", actorLabel: "vanshaj" },
      }),
    );
    expect(step(steps, "plan_assigned").note).toContain("Klik Premium");
  });

  it("counts what exists rather than saying a bare yes", () => {
    const steps = resolveChain(account({ activatedAt: ACTIVATED }), counts(3, 1), NOTHING);
    expect(step(steps, "event_created").note).toContain("3 events");
    // Singular, because "1 files" on an admin panel is the kind of thing that
    // makes the rest of the numbers look untrustworthy.
    expect(step(steps, "guests_uploading").note).toContain("1 file so far");
  });
});
