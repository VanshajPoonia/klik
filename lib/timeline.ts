import { nanoid } from "nanoid";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { accountTimeline, events, media } from "./schema";
import type { TimelineKind } from "./schema";
import { reportError } from "./observability";

/**
 * The history behind an account, and the chain of steps derived from it.
 *
 * Two jobs that belong together. `recordAccountEvent` appends what happened;
 * `getAccountChains` answers the question /admin actually asks, which is how far
 * each customer has got and whose turn it is. Keeping them in one file is what
 * stops a new recorded event never appearing in the chain.
 */

/**
 * Append one row. Never throws, and never fails its caller.
 *
 * Every call site is something more important than the log entry: a signup, an
 * activation, a send. Losing the entry is a worse history; letting the entry
 * lose the activation is a customer who paid and got nothing. The whole function
 * is wrapped for that reason, and the catch reports rather than swallows so a
 * table that is missing or unwritable is visible rather than merely quiet.
 */
export async function recordAccountEvent({
  userId,
  kind,
  detail = null,
  actor = null,
}: {
  userId: string;
  kind: TimelineKind;
  detail?: string | null;
  /** Who did it. Omitted for anything the system did to itself, such as a signup. */
  actor?: { id: string; label: string | null } | null;
}): Promise<void> {
  try {
    await db.insert(accountTimeline).values({
      id: nanoid(),
      userId,
      kind,
      detail,
      actorUserId: actor?.id ?? null,
      actorLabel: actor?.label ?? null,
    });
  } catch (error) {
    reportError("timeline.record_failed", error, { userId, kind });
  }
}

/** One account's history, newest first. */
export async function getAccountTimeline(userId: string, limit = 50) {
  return db
    .select()
    .from(accountTimeline)
    .where(eq(accountTimeline.userId, userId))
    .orderBy(desc(accountTimeline.createdAt))
    .limit(limit);
}

/**
 * Whose turn each step is.
 *
 * `action` is the only one that means anything has to be done by the person
 * reading /admin, which is why it is distinct from `waiting`. A board where
 * everything incomplete looks urgent is a board nobody reads.
 */
export type ChainState =
  /** Happened. `at` says when, where we know. */
  | "done"
  /** Nothing for us to do. Either the customer's turn, or an earlier step first. */
  | "waiting"
  /** The superadmin has to do something here. */
  | "action"
  /** Genuinely not knowable from the data. Says so rather than guessing. */
  | "unknown";

export type ChainStep = {
  key: string;
  label: string;
  state: ChainState;
  at: Date | null;
  /** One line: what this means now, or what unblocks it. */
  note: string;
};

export type ChainInput = {
  userId: string;
  email: string | null;
  createdAt: Date;
  activatedAt: Date | null;
  activationEmailSentAt: Date | null;
  planName: string;
};

/** One recorded entry, reduced to what the chain reads from it. */
export type TimelineFact = {
  detail: string | null;
  actorLabel: string | null;
  createdAt: Date;
};

/**
 * The seven steps between somebody arriving and their guests uploading.
 *
 * Pure, and separate from the queries below on purpose: this is where every
 * judgement about whose turn it is lives, and it is the part worth testing. The
 * database half is a gather with no decisions in it.
 *
 * Derived, never stored. The state columns and the history table are the inputs,
 * and a stored copy of this answer would be one more thing to disagree with
 * them.
 */
export function resolveChain(
  account: ChainInput,
  counts: { eventCount: number; mediaCount: number },
  /** Latest entry per kind. Absent means it never happened, or predates the log. */
  latest: Map<string, TimelineFact>,
): ChainStep[] {
  const activated = Boolean(account.activatedAt);
  const { eventCount, mediaCount } = counts;

  return [
    {
      key: "signed_up",
      label: "Account created",
      state: "done",
      at: account.createdAt,
      note: account.email ?? "No email address on file.",
    },
    welcomeEmailStep(latest),
    paymentStep(account, activated),
    planStep(account, activated, latest),
    accessEmailStep(account, activated),
    {
      key: "event_created",
      label: "Event created",
      state: eventCount > 0 ? "done" : "waiting",
      at: latest.get("event_created")?.createdAt ?? null,
      note:
        eventCount > 0
          ? `${eventCount} ${eventCount === 1 ? "event" : "events"}.`
          : activated
            ? "Theirs to do, and the QR and sign are generated the moment they do it."
            : "Unlocks when you activate them.",
    },
    {
      key: "guests_uploading",
      label: "Guests uploading",
      state: mediaCount > 0 ? "done" : "waiting",
      at: null,
      note:
        mediaCount > 0
          ? `${mediaCount} ${mediaCount === 1 ? "file" : "files"} so far.`
          : eventCount > 0
            ? "Nothing uploaded yet. Normal until the day of the event."
            : "Needs an event first.",
    },
  ];
}

function welcomeEmailStep(latest: Map<string, TimelineFact>): ChainStep {
  const sent = latest.get("welcome_email_sent");
  if (sent) {
    return {
      key: "welcome_email",
      label: "Welcome email",
      state: "done",
      at: sent.createdAt,
      note: sent.detail ?? "Sent at signup.",
    };
  }

  const failed = latest.get("welcome_email_failed");
  if (failed) {
    return {
      key: "welcome_email",
      label: "Welcome email",
      state: "action",
      at: failed.createdAt,
      note: failed.detail ?? "The send was refused. Check the address.",
    };
  }

  // An absent row is genuinely ambiguous: either nothing was sent, or the
  // account predates this log. Rendering "not sent" would be a guess, and the
  // superadmin would act on it.
  return {
    key: "welcome_email",
    label: "Welcome email",
    state: "unknown",
    at: null,
    note: "No record. Accounts created before the history log started have none either way.",
  };
}

/**
 * The step nothing in Klik can observe.
 *
 * A Stripe-hosted Payment Link reports to Stripe and tells this application
 * nothing at all, so there is no honest way to render a tick here on its own.
 * Once a plan is assigned it becomes one anyway, because assigning the plan *is*
 * a human confirming the payment: that is the whole workflow in BILLING.md.
 */
function paymentStep(account: ChainInput, activated: boolean): ChainStep {
  if (activated) {
    return {
      key: "payment",
      label: "Payment confirmed",
      state: "done",
      at: account.activatedAt,
      note: "Confirmed by whoever assigned the plan. Klik never sees the payment itself.",
    };
  }
  return {
    key: "payment",
    label: "Payment confirmed",
    state: "action",
    at: null,
    note: account.email
      ? `Search Stripe for ${account.email}. A hosted Payment Link tells Klik nothing.`
      : "No email address to search Stripe by.",
  };
}

function planStep(
  account: ChainInput,
  activated: boolean,
  latest: Map<string, TimelineFact>,
): ChainStep {
  if (!activated) {
    return {
      key: "plan_assigned",
      label: "Plan assigned",
      state: "action",
      at: null,
      note: "Assign a plan above. That activates them and emails them.",
    };
  }

  const granted = latest.get("plan_assigned");
  const changed = latest.get("plan_changed");
  const by = granted?.actorLabel ?? changed?.actorLabel;
  return {
    key: "plan_assigned",
    label: "Plan assigned",
    state: "done",
    at: account.activatedAt,
    note: [`${account.planName}.`, by ? `Granted by ${by}.` : null, changed?.detail ?? null]
      .filter(Boolean)
      .join(" "),
  };
}

function accessEmailStep(account: ChainInput, activated: boolean): ChainStep {
  if (!activated) {
    return {
      key: "access_email",
      label: "Access email",
      state: "waiting",
      at: null,
      note: "Sends itself the moment you assign a plan.",
    };
  }
  if (account.activationEmailSentAt) {
    return {
      key: "access_email",
      label: "Access email",
      state: "done",
      at: account.activationEmailSentAt,
      note: "They have the link to their dashboard.",
    };
  }
  return {
    key: "access_email",
    label: "Access email",
    state: "action",
    at: null,
    note: account.email
      ? "Activated but never notified. Send it from the control above."
      : "No email address on file. Call them instead.",
  };
}

/**
 * Gather what `resolveChain` needs for a page of accounts, in three queries
 * rather than three per account.
 */
export async function getAccountChains(
  accounts: ChainInput[],
): Promise<Map<string, ChainStep[]>> {
  const result = new Map<string, ChainStep[]>();
  if (accounts.length === 0) return result;

  const userIds = accounts.map((account) => account.userId);

  const [eventCounts, mediaCounts, entries] = await Promise.all([
    db
      .select({ ownerId: events.ownerId, n: sql<number>`count(*)::int` })
      .from(events)
      .where(and(inArray(events.ownerId, userIds), isNull(events.deletedAt)))
      .groupBy(events.ownerId),
    db
      .select({ ownerId: events.ownerId, n: sql<number>`count(*)::int` })
      .from(media)
      .innerJoin(events, eq(media.eventId, events.id))
      .where(
        and(
          inArray(events.ownerId, userIds),
          isNull(events.deletedAt),
          isNull(media.deletedAt),
        ),
      )
      .groupBy(events.ownerId),
    db
      .select({
        userId: accountTimeline.userId,
        kind: accountTimeline.kind,
        detail: accountTimeline.detail,
        actorLabel: accountTimeline.actorLabel,
        createdAt: accountTimeline.createdAt,
      })
      .from(accountTimeline)
      .where(inArray(accountTimeline.userId, userIds))
      .orderBy(desc(accountTimeline.createdAt)),
  ]);

  const eventsBy = new Map(eventCounts.map((row) => [row.ownerId, row.n]));
  const mediaBy = new Map(mediaCounts.map((row) => [row.ownerId, row.n]));

  // Newest first above, so the first time a kind is seen is its latest
  // occurrence. A plan corrected twice leaves two rows, and this takes the one
  // that is currently true.
  const byUser = new Map<string, Map<string, TimelineFact>>();
  for (const entry of entries) {
    let forUser = byUser.get(entry.userId);
    if (!forUser) {
      forUser = new Map();
      byUser.set(entry.userId, forUser);
    }
    if (!forUser.has(entry.kind)) {
      forUser.set(entry.kind, {
        detail: entry.detail,
        actorLabel: entry.actorLabel,
        createdAt: entry.createdAt,
      });
    }
  }

  for (const account of accounts) {
    result.set(
      account.userId,
      resolveChain(
        account,
        {
          eventCount: eventsBy.get(account.userId) ?? 0,
          mediaCount: mediaBy.get(account.userId) ?? 0,
        },
        byUser.get(account.userId) ?? new Map(),
      ),
    );
  }

  return result;
}
