import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import {
  SHARE_COOKIE_MAX_AGE,
  shareCookieName,
  signShareViewer,
  verifyShareViewer,
} from "@/lib/guest";
import { clientIp, consume } from "@/lib/ratelimit";
import { DENIAL_COPY, evaluateShare } from "@/lib/share-access";
import { loadShareByToken, shareTargetExists, verifySharePassword } from "@/lib/shares";

const bodySchema = z.object({ password: z.string().min(1).max(200) });

/**
 * Ten attempts an hour per link per address.
 *
 * A share password is typed by a guest from a chat message, so it is short and
 * sometimes a word. That makes the password the weak part of the link rather
 * than the token, and the limit is what stops it being walked offline-fast.
 */
const UNLOCK_ATTEMPTS_PER_HOUR = 10;

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter the password" }, { status: 400 });
  }

  const resolved = await loadShareByToken(token);
  // Deliberately the same refusal for a token that does not exist and one that
  // does but has no password: both are "there is nothing to unlock here", and
  // separating them would turn this route into a way to test whether a token is
  // real without ever holding the password.
  if (!resolved || !shareTargetExists(resolved) || !resolved.share.passwordHash) {
    return NextResponse.json({ error: DENIAL_COPY.not_found.title }, { status: 404 });
  }

  const { share } = resolved;
  // Captured before the awaits below so the narrowing above survives them.
  const passwordHash = resolved.share.passwordHash;

  const limit = await consume(
    `share:unlock:${share.id}:${clientIp(request)}`,
    UNLOCK_ATTEMPTS_PER_HOUR,
    3600,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many tries. Wait a little and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  // Revoked, expired and spent are all checked before the password is even
  // compared, so a dead link cannot be probed for a valid password.
  const gate = evaluateShare(share, { unlocked: true, counted: false });
  if (!gate.ok) {
    return NextResponse.json(
      { error: DENIAL_COPY[gate.reason].title },
      { status: gate.reason === "not_found" ? 404 : 410 },
    );
  }

  const valid = await verifySharePassword(parsed.data.password, passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "That password is not right." }, { status: 401 });
  }

  // Preserve whatever this browser had already established. Overwriting the
  // cookie wholesale would reset `counted`, which would let one viewer spend the
  // cap again every time they re-entered the password.
  const cookieStore = await cookies();
  const existing = cookieStore.get(shareCookieName(share.id))?.value;
  const previous = existing ? await verifyShareViewer(existing, share.id) : null;

  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    shareCookieName(share.id),
    await signShareViewer({
      shareId: share.id,
      unlocked: true,
      counted: previous?.counted ?? false,
    }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SHARE_COOKIE_MAX_AGE,
    },
  );
  return response;
}
