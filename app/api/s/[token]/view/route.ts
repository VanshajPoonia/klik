import { NextResponse } from "next/server";
import {
  SHARE_COOKIE_MAX_AGE,
  shareCookieName,
  signShareViewer,
} from "@/lib/guest";
import { resolveShareRequest } from "@/lib/share-request";
import { denialStatus, DENIAL_COPY } from "@/lib/share-access";
import { countShareView } from "@/lib/shares";

/**
 * Counts one view, once per browser.
 *
 * **Why this is a request from the page rather than part of rendering it.** A
 * link like this travels through WhatsApp and iMessage, and those clients fetch
 * the page to build a preview: in a group chat, potentially once per member, and
 * again every time someone scrolls back to it. If the view were counted while
 * rendering, sending a one-view link would spend that view on a preview card
 * before the person it was meant for ever tapped it. Crawlers do not run
 * JavaScript, so counting from the page after it loads is what separates "a
 * person looked at this" from "a chat app drew a thumbnail".
 *
 * Two consequences are accepted knowingly. A viewer with JavaScript disabled is
 * never counted, and two people opening the last view of a link at the same
 * instant can both get in, because the gate runs before either increment. So
 * `max_views` is a courtesy limit on how far a link travels, not a security
 * boundary. Revocation is the hard control, and it is checked on every single
 * request with no caching anywhere.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolveShareRequest(token);

  if (!resolved.ok) {
    return NextResponse.json(
      { error: DENIAL_COPY[resolved.reason].title },
      { status: denialStatus(resolved.reason) },
    );
  }

  const { share, viewer } = resolved;

  // Already counted, so a reload, a rotation, or a second tab is free. This is
  // what makes "a re-render does not burn the cap" literally true rather than
  // merely likely.
  if (viewer.counted) return NextResponse.json({ counted: false });

  const spent = await countShareView(token);
  if (!spent) {
    // The link was revoked, expired, or had its last view taken by someone else
    // between the page rendering and this call. The client reloads on this, so
    // the viewer sees the real refusal instead of a photo that should be gone.
    return NextResponse.json({ error: DENIAL_COPY.exhausted.title }, { status: 410 });
  }

  const response = NextResponse.json({ counted: true });
  response.cookies.set(
    shareCookieName(share.id),
    await signShareViewer({
      shareId: share.id,
      // Preserved, not recomputed: this browser may have entered a password to
      // get here, and dropping that would send it back to the gate on reload.
      unlocked: viewer.unlocked,
      counted: true,
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
