import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { sendEmail } from "./email";
import { noticeEmail } from "./emails/notice";
import { getAppUrl } from "./env";
import { hashPassword } from "./credentials";
import { PASSWORD_MAX, PASSWORD_MIN, passwordRestatesEmail } from "./signup";
import { recordAccountEvent } from "./timeline";
import { passwordLinks, users } from "./schema";

/**
 * ACC-8: an account on /admin, a login Klik made especially, can be sent a
 * link to choose its own password, instead of one a superadmin reads out or
 * pastes into a message. The link works once, for seven days, and the newest
 * one for an account is the only one that works.
 */
export const PASSWORD_LINK_DAYS = 7;

export function hashPasswordLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Ends any earlier link for the account and makes a new one. Returns the code, which is not kept. */
export async function createPasswordLink(userId: string, createdByUserId: string | null): Promise<{ token: string; expiresAt: Date }> {
  await db
    .update(passwordLinks)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordLinks.userId, userId), isNull(passwordLinks.usedAt)));
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + PASSWORD_LINK_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(passwordLinks).values({
    id: `pwl_${nanoid()}`,
    userId,
    tokenHash: hashPasswordLinkToken(token),
    createdByUserId,
    expiresAt,
  });
  return { token, expiresAt };
}

export function passwordLinkUrl(token: string): string {
  return `${getAppUrl()}/set-password/${encodeURIComponent(token)}`;
}

/** One-to-one mail, so it is never held back for the day's bulk limit. */
export async function sendPasswordLink(account: { email: string; username: string | null; name: string | null }, token: string) {
  const greeting = account.name?.trim() ? `Hello ${account.name.trim().split(/\s+/)[0]},` : "Hello,";
  const message = noticeEmail({
    subject: "Choose your Klik password",
    heading: "Choose your password",
    paragraphs: [
      greeting,
      account.username
        ? `Your Klik account is ready. You sign in as @${account.username}, with a password you choose from this link.`
        : "Your Klik account is ready. Choose a password from this link to sign in.",
    ],
    cta: { label: "Choose a password", url: passwordLinkUrl(token) },
    footer: `The link works once, for ${PASSWORD_LINK_DAYS} days. If you were not expecting it, ignore it: nothing changes unless you use it.`,
  });
  return sendEmail({ ...message, to: account.email });
}

export type PasswordLinkState =
  | { state: "valid"; userId: string; username: string | null; email: string | null }
  | { state: "used" | "expired" | "missing" };

export async function lookupPasswordLink(token: string): Promise<PasswordLinkState> {
  if (!token || token.length > 64) return { state: "missing" };
  const [row] = await db
    .select({
      userId: passwordLinks.userId,
      expiresAt: passwordLinks.expiresAt,
      usedAt: passwordLinks.usedAt,
      username: users.username,
      email: users.email,
    })
    .from(passwordLinks)
    .innerJoin(users, eq(users.id, passwordLinks.userId))
    .where(eq(passwordLinks.tokenHash, hashPasswordLinkToken(token)))
    .limit(1);
  if (!row) return { state: "missing" };
  if (row.usedAt) return { state: "used" };
  if (row.expiresAt.getTime() <= Date.now()) return { state: "expired" };
  return { state: "valid", userId: row.userId, username: row.username, email: row.email };
}

export type ChoosePasswordResult =
  | { ok: true; username: string | null }
  | { ok: false; reason: "used" | "expired" | "missing" | "too_short" | "too_long" | "restates_email" };

/**
 * Spends the link and sets the password. The link is claimed by one
 * conditional update before anything else changes, so two tabs submitting at
 * once cannot both set a password. Ends every other session, as a password
 * change always does.
 */
export async function choosePassword(token: string, password: string): Promise<ChoosePasswordResult> {
  if (password.length < PASSWORD_MIN) return { ok: false, reason: "too_short" };
  if (password.length > PASSWORD_MAX) return { ok: false, reason: "too_long" };
  const link = await lookupPasswordLink(token);
  if (link.state !== "valid") return { ok: false, reason: link.state };
  if (link.email && passwordRestatesEmail(password, link.email)) return { ok: false, reason: "restates_email" };

  const [claimed] = await db
    .update(passwordLinks)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordLinks.tokenHash, hashPasswordLinkToken(token)),
        isNull(passwordLinks.usedAt),
        sql`${passwordLinks.expiresAt} > now()`,
      ),
    )
    .returning({ userId: passwordLinks.userId });
  if (!claimed) return { ok: false, reason: "used" };

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), credentialVersion: sql`${users.credentialVersion} + 1` })
    .where(eq(users.id, claimed.userId));
  await recordAccountEvent({ userId: claimed.userId, kind: "password_changed", detail: "Chosen from a link Klik emailed." });
  return { ok: true, username: link.username };
}
