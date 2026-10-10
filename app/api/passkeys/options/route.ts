import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { clientIp, consume } from "@/lib/ratelimit";
import {
  PASSKEY_CHALLENGE_COOKIE,
  PASSKEY_CHALLENGE_SECONDS,
  PASSKEY_LIMIT,
  registrationOptions,
  relyingPartyFor,
  sealCeremony,
  signInOptions,
} from "@/lib/passkeys";

const schema = z.object({ purpose: z.enum(["register", "signin"]) });

/**
 * ACC-6: starts a passkey ceremony. Returns what the browser hands to the
 * phone, and sets the one-time challenge in a cookie the answer must carry
 * back. Signing in needs no account; adding a passkey needs a signed-in one.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { purpose } = parsed.data;

  const rp = relyingPartyFor(request.url);
  if (!rp) {
    return NextResponse.json({ error: "Passkeys work only on Klik's own address." }, { status: 400 });
  }

  let options: unknown;
  let userId: string | null = null;
  if (purpose === "signin") {
    // The sign-in page asks for options as it opens, so the phone can offer a
    // passkey in the email field. Generous, but not free.
    const limit = await consume(`passkey:options-ip:${clientIp(request)}`, 60, 15 * 60);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many tries. Wait a few minutes." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
    }
    options = await signInOptions(rp);
  } else {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    userId = session.user.id;
    const limit = await consume(`passkey:register:${userId}`, 20, 60 * 60);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many tries. Wait a few minutes." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
    }
    const [account] = await db
      .select({ id: users.id, email: users.email, username: users.username, name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!account) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    const result = await registrationOptions(account, rp);
    if (result.full) {
      return NextResponse.json(
        { error: `An account can have ${PASSKEY_LIMIT} passkeys. Remove one first.` },
        { status: 409 },
      );
    }
    options = result.options;
  }

  const challenge = (options as { challenge: string }).challenge;
  const response = NextResponse.json(
    { options, ...(userId ? { userHandle: isoBase64URL.fromUTF8String(userId) } : {}) },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(PASSKEY_CHALLENGE_COOKIE, await sealCeremony({ challenge, purpose, origin: rp.origin, userId }), {
    httpOnly: true,
    secure: rp.origin.startsWith("https:"),
    sameSite: "strict",
    path: "/api",
    maxAge: PASSKEY_CHALLENGE_SECONDS,
  });
  return response;
}
