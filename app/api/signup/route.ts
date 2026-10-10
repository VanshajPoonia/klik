import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { hashPassword } from "@/lib/credentials";
import { signupSchema, usernameFromEmail } from "@/lib/signup";
import { clientIp, consume } from "@/lib/ratelimit";
import { sendEmail } from "@/lib/email";
import { onboardingEmail } from "@/lib/emails/onboarding";
import { getAppUrl } from "@/lib/env";
import { log, reportError } from "@/lib/observability";
import { recordAccountEvent } from "@/lib/timeline";
import { isUniqueViolation, raisedBy } from "@/lib/db-errors";
import { REFERRAL_COOKIE, attachReferral } from "@/lib/referrals";
import { cookieFrom } from "@/lib/request-cookies";

/**
 * Creates an organizer account from the public signup form.
 *
 * Not under /api/auth: that prefix belongs to next-auth's catch-all, and a
 * static sibling segment inside it silently shadows whichever of its own
 * endpoints happens to share the name.
 *
 * **The account it creates is not entitled to anything.** `activated_at` stays
 * null, so the dashboard opens and event creation is refused until a superadmin
 * grants the plan. That is the whole reason this route can exist at all:
 * `users.plan_key` defaults to 'event', so without the gate this endpoint hands
 * out the $39 product to anyone who fills in a form. See
 * drizzle/0013_self_signup.sql.
 */

async function emailTaken(email: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    // Lowercase on both sides. Emails are stored normalised by this route, but
    // the OAuth adapter and the seed script write whatever they are given, and a
    // case-sensitive comparison would let `Sam@venue.com` create a second
    // account for a person who already has one.
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  return Boolean(existing);
}

export async function POST(request: Request) {
  // Both buckets, for two different abuses. Per-IP stops one host creating
  // accounts in bulk; per-email stops the same address being used to send
  // somebody else a stream of welcome mail from our verified domain.
  const ip = clientIp(request);
  const byIp = await consume(`signup:ip:${ip}`, 5, 60 * 60);
  if (!byIp.allowed) {
    return NextResponse.json(
      { error: "Too many accounts created from here. Try again later." },
      { status: 429, headers: { "Retry-After": String(byIp.retryAfter) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the form and try again" },
      { status: 400 },
    );
  }
  const { name, email, password } = parsed.data;

  const byEmail = await consume(`signup:email:${email}`, 3, 60 * 60);
  if (!byEmail.allowed) {
    return NextResponse.json(
      { error: "Too many attempts for this address. Try again later." },
      { status: 429, headers: { "Retry-After": String(byEmail.retryAfter) } },
    );
  }

  // Said plainly rather than hidden behind a vague "check your email".
  // Concealing it is the textbook defence against account enumeration, and the
  // trade is wrong here: the membership being leaked is "this venue uses Klik",
  // which is close to public anyway, and the cost of the vague version is a
  // support call from someone who cannot tell whether they just made an account
  // or not. The login form is throttled per username and per IP, which is where
  // the actual attack on a known address gets stopped.
  if (await emailTaken(email)) {
    return NextResponse.json(
      { error: "There is already an account with this email. Sign in instead." },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);

  // Same shape as the admin path: the username carries a random suffix, so a
  // collision is a one-in-a-million event rather than an impossibility, and the
  // only correct response to one is another attempt.
  let created: { id: string; username: string | null } | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      [created] = await db
        .insert(users)
        .values({
          id: nanoid(),
          name,
          email,
          role: "organizer",
          username: usernameFromEmail(email),
          passwordHash,
          // Explicit, though it is also the column default. This is the line
          // someone will come looking for when they ask why a new signup cannot
          // create an event, and a default is not an answer.
          activatedAt: null,
          // ACC-2: this form is for running events, so it is what puts the
          // account in the activation queue. A code sign-in does not.
          organizerIntentAt: new Date(),
        })
        .returning({ id: users.id, username: users.username });
      break;
    } catch (error) {
      // A generated handle can also land on one somebody parked (ID-1), which
      // the trigger refuses. Same answer: another attempt, another suffix.
      if (!isUniqueViolation(error) && !raisedBy(error, "username_reserved")) throw error;
      // Which unique constraint was it? Asked by querying rather than by
      // matching a constraint name, because these indexes were created by
      // drizzle-kit push and their names are not written down in any migration
      // here. A name that is only true by convention is a bad thing to branch on.
      if (await emailTaken(email)) {
        return NextResponse.json(
          { error: "There is already an account with this email. Sign in instead." },
          { status: 409 },
        );
      }
      if (attempt === 4) throw error;
    }
  }
  if (!created) {
    return NextResponse.json({ error: "Could not create the account" }, { status: 500 });
  }

  log.info("signup.created", { userId: created.id });

  // No actor: nobody did this to them, they did it themselves. That is the
  // distinction the actor column exists to make.
  await recordAccountEvent({
    userId: created.id,
    kind: "account_created",
    // The route does not receive the plan the dialog was opened from, so there
    // is nothing honest to say about intent here. Carrying it through the form
    // would make this row answer "which plan were they trying to buy", which is
    // the first thing asked about a signup that never paid.
    detail: "Signed up through the form.",
  });

  // GRW-5: who sent them, if a referral link did. Never worth failing a signup over.
  await attachReferral(created.id, cookieFrom(request.headers.get("cookie"), REFERRAL_COOKIE)).catch((error) =>
    reportError("signup.referral_failed", error, { userId: created.id }),
  );

  // Best effort, and deliberately after the account exists. A welcome email that
  // cannot be sent is a bad morning; an account rolled back because of it is a
  // person who paid and has nothing. `sendEmail` reports instead of throwing, so
  // the only failure left to guard is an unexpected one.
  try {
    const message = onboardingEmail({ name, appUrl: getAppUrl() });
    const result = await sendEmail({ ...message, to: email });
    await recordAccountEvent({
      userId: created.id,
      kind: result.sent ? "welcome_email_sent" : "welcome_email_failed",
      detail: result.sent
        ? `Sent to ${email}.`
        : result.reason === "not_configured"
          ? "Email is not configured on this deployment."
          : `The provider refused the send to ${email}.`,
    });
  } catch (error) {
    reportError("signup.welcome_email_failed", error, { userId: created.id });
    await recordAccountEvent({
      userId: created.id,
      kind: "welcome_email_failed",
      detail: "Sending failed unexpectedly.",
    });
  }

  return NextResponse.json({ email, username: created.username }, { status: 201 });
}
