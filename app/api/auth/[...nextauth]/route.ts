import { NextResponse, type NextRequest } from "next/server";
import { handlers } from "@/lib/auth";
import { clientIp, consume } from "@/lib/ratelimit";
import {
  SIGN_IN_CODE_ATTEMPTS,
  SIGN_IN_CODE_WINDOW_SECONDS,
  normalizeSignInEmail,
} from "@/lib/sign-in-code";

/**
 * Auth.js, with ACC-2's two limits in front of it.
 *
 * A six-digit code is a million guesses, and Auth.js counts none of them: a
 * wrong code leaves the right one in place. So guesses are counted per address
 * (across every code sent to it, or a fresh code would reset the count) and per
 * network, and sends are counted too, because each one is an email from our
 * domain to an address somebody typed.
 */

const tooMany = (request: NextRequest) => new URL("/login?error=TooManyAttempts", request.url);

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/callback/resend")) {
    const email = normalizeSignInEmail(url.searchParams.get("email") ?? "");
    const [byEmail, byIp] = await Promise.all([
      consume(`signin-code:verify:${email}`, SIGN_IN_CODE_ATTEMPTS, SIGN_IN_CODE_WINDOW_SECONDS),
      consume(`signin-code:verify-ip:${clientIp(request)}`, 30, SIGN_IN_CODE_WINDOW_SECONDS),
    ]);
    if (!byEmail.allowed || !byIp.allowed) return NextResponse.redirect(tooMany(request), 303);
  }
  return handlers.GET(request);
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/signin/resend")) {
    const form = await request.clone().formData().catch(() => null);
    const email = normalizeSignInEmail(String(form?.get("email") ?? ""));
    const [byEmail, byIp] = await Promise.all([
      consume(`signin-code:send:${email}`, 3, 10 * 60),
      consume(`signin-code:send-ip:${clientIp(request)}`, 15, 60 * 60),
    ]);
    if (!byEmail.allowed || !byIp.allowed) {
      // The shape next-auth/react's signIn() reads when it is not redirecting,
      // which is how the form calls it; the error lands in `result.error`.
      return NextResponse.json({ url: tooMany(request).toString() });
    }
  }
  return handlers.POST(request);
}
