import { NextResponse } from "next/server";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_DAYS, isReferralCode, referrerByCode } from "@/lib/referrals";

/**
 * GRW-5: a referral link. Remembers whose it was for 30 days and goes to the
 * home page, where every way to buy leads through signup, which reads it. An
 * unknown code still lands on the home page: a broken invitation should not
 * look like a broken site.
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const home = new URL("/", request.url);
  const response = NextResponse.redirect(home, 307);
  const normalized = code.toLowerCase();
  if (isReferralCode(normalized) && (await referrerByCode(normalized))) {
    response.cookies.set(REFERRAL_COOKIE, normalized, {
      httpOnly: true,
      sameSite: "lax",
      secure: home.protocol === "https:",
      path: "/",
      maxAge: REFERRAL_COOKIE_DAYS * 24 * 60 * 60,
    });
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
