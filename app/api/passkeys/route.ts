import { after, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { getAppUrl } from "@/lib/env";
import { sendEmail } from "@/lib/email";
import { passkeyAddedEmail } from "@/lib/emails/passkey-added";
import { recordAccountEvent } from "@/lib/timeline";
import { reportError } from "@/lib/observability";
import { parsePasskeyRegistration } from "@/lib/passkey-answers";
import {
  PASSKEY_CHALLENGE_COOKIE,
  cookieFrom,
  listPasskeys,
  openCeremony,
  registerPasskey,
  relyingPartyFor,
} from "@/lib/passkeys";

/** ACC-6: the signed-in account's passkeys. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ passkeys: await listPasskeys(session.user.id) }, { headers: { "Cache-Control": "no-store" } });
}

const schema = z.object({
  response: z.unknown(),
  name: z.string().max(120).optional(),
});

/**
 * ACC-6: saves a passkey the phone just made. The challenge it signed must be
 * the one issued to this same account a moment ago, so an answer made for one
 * account cannot be saved onto another.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const rp = relyingPartyFor(request.url);
  if (!rp) return NextResponse.json({ error: "Passkeys work only on Klik's own address." }, { status: 400 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  const response = parsed.success ? parsePasskeyRegistration(parsed.data.response) : null;
  if (!parsed.success || !response) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const ceremony = await openCeremony(cookieFrom(request.headers.get("cookie"), PASSKEY_CHALLENGE_COOKIE), {
    purpose: "register",
    origin: rp.origin,
  });
  if (!ceremony || ceremony.userId !== userId) {
    return NextResponse.json({ error: "That took too long. Try again." }, { status: 400 });
  }

  const outcome = await registerPasskey({
    userId,
    response,
    expectedChallenge: ceremony.challenge,
    rp,
    name: parsed.data.name ?? null,
    userAgent: request.headers.get("user-agent"),
  });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  await recordAccountEvent({ userId, kind: "passkey_added", detail: outcome.passkey.name });

  // A passkey is a way in that outlives every session, so the owner hears
  // about each one at the address they control. If a stolen session added it,
  // this is how they find out.
  after(async () => {
    try {
      const [account] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
      if (!account?.email) return;
      const appUrl = getAppUrl();
      await sendEmail({
        to: account.email,
        ...passkeyAddedEmail({
          name: account.name,
          passkeyName: outcome.passkey.name,
          accountUrl: `${appUrl}/dashboard/account#passkeys`,
          appUrl,
        }),
      });
    } catch (error) {
      reportError("passkey.notice_failed", error, { userId });
    }
  });

  const result = NextResponse.json({ passkey: outcome.passkey }, { status: 201 });
  result.cookies.delete({ name: PASSKEY_CHALLENGE_COOKIE, path: "/api" });
  return result;
}
