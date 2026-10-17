import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, consume } from "@/lib/ratelimit";
import { choosePassword } from "@/lib/password-links";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/signup";

/** ACC-8: spends a link from the email and sets the password it chose. */
const schema = z.object({ token: z.string().min(1).max(64), password: z.string().max(PASSWORD_MAX * 4) });

const MESSAGES = {
  used: "This link has been used, or a newer one was sent. Ask Klik for another.",
  expired: "This link has expired. Ask Klik for another.",
  missing: "This link is not valid. Check you opened the whole link from the email.",
  too_short: `At least ${PASSWORD_MIN} characters.`,
  too_long: `At most ${PASSWORD_MAX} characters.`,
  restates_email: "Choose a password that does not contain your email.",
} as const;

export async function POST(request: Request) {
  const limit = await consume(`set-password:ip:${clientIp(request)}`, 10, 15 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: MESSAGES.missing }, { status: 400 });
  const result = await choosePassword(parsed.data.token, parsed.data.password);
  if (!result.ok) {
    const gone = result.reason === "used" || result.reason === "expired" || result.reason === "missing";
    return NextResponse.json({ error: MESSAGES[result.reason], code: result.reason }, { status: gone ? 410 : 400 });
  }
  return NextResponse.json({ ok: true, username: result.username });
}
