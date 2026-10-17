import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { and, count, eq, isNull, or } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { eventCoHosts, events, userPasskeys } from "@/lib/schema";
import { claimGuestCookies, galleriesInBrowser, joinedGalleries, type JoinedGallery } from "@/lib/guest-accounts";
import { Card } from "@/components/ui/card";
import { buttonClassName } from "@/components/ui/button";
import { JoinedGalleryRow } from "@/components/me/joined-gallery-row";
import { PasskeyPrompt } from "@/components/me/passkey-prompt";

export const metadata: Metadata = { title: "Your galleries", robots: { index: false } };

/**
 * ACC-4: the account as a guest sees it. The galleries you joined, from any
 * phone you joined them on while signed in, and from this phone's anonymous
 * visits, which are claimed on the way in.
 *
 * Without an account it is the galleries this browser joined, from its guest
 * cookies, so a guest who never signed in can still get from one event to
 * another; signing in is offered to keep them on every phone.
 */
export default async function MePage() {
  const session = await auth();
  if (!session?.user?.id) {
    const galleries = await galleriesInBrowser((await cookies()).getAll());
    // Nothing joined here and no account: signing in is all this page has.
    if (galleries.length === 0) redirect("/login?next=/me");
    return <BrowserGalleries galleries={galleries} />;
  }
  const userId = session.user.id;

  // ACC-3. Idempotent, so reloading the page is harmless.
  await claimGuestCookies(userId, (await cookies()).getAll());

  const [galleries, [hosting], [passkeys]] = await Promise.all([
    joinedGalleries(userId),
    db
      .select({ n: count() })
      .from(events)
      .leftJoin(eventCoHosts, and(eq(eventCoHosts.eventId, events.id), eq(eventCoHosts.userId, userId), isNull(eventCoHosts.deletedAt)))
      .where(and(isNull(events.deletedAt), or(eq(events.ownerId, userId), eq(eventCoHosts.userId, userId)))),
    db.select({ n: count() }).from(userPasskeys).where(eq(userPasskeys.userId, userId)),
  ]);
  const hostsEvents = (hosting?.n ?? 0) > 0;

  return (
    <div className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-10 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/klik-mark.png" alt="" width={32} height={32} className="rounded-[8px]" />
            <span className="text-lg font-semibold tracking-tight">klik</span>
          </Link>
          <Link href="/dashboard/account" className="text-sm text-muted hover:text-paper">
            Account
          </Link>
        </header>

        <h1 className="font-display text-2xl text-paper">Your galleries</h1>
        <p className="mt-2 text-sm text-muted">
          Every event you joined while signed in, or on this phone before you signed in.
        </p>

        <div className="mt-8 space-y-3">
          {galleries.length === 0 ? (
            <Card className="text-center text-sm text-muted">
              Nothing here yet. Scan an event&apos;s QR code while signed in and it appears here.
            </Card>
          ) : (
            galleries.map((gallery) => <JoinedGalleryRow key={gallery.eventId} gallery={gallery} />)
          )}
        </div>

        {/* ACC-6: offered only to an account with no passkey yet. */}
        {(passkeys?.n ?? 0) === 0 && <PasskeyPrompt />}

        {/* The guest to organizer path (ACC-4). One identity, so this is not a
            second sign-up: it is the same account, choosing a plan. */}
        <Card className="mt-10">
          {hostsEvents ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-medium text-paper">Events you run</h2>
                <p className="mt-1 text-xs text-muted">Your own events and the ones you help with.</p>
              </div>
              <Link href="/dashboard" className={buttonClassName({ variant: "ghost", size: "sm" })}>
                Open your dashboard
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-medium text-paper">Running an event of your own?</h2>
                <p className="mt-1 max-w-sm text-xs text-muted">
                  One QR code, and every guest&apos;s photos and videos in one gallery, at full
                  quality. You use this same account.
                </p>
              </div>
              <Link href="/#pricing" className={buttonClassName({ size: "sm" })}>
                See plans
              </Link>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/** "Your galleries" for a guest without an account: this browser's, and a way to keep them. */
function BrowserGalleries({ galleries }: { galleries: JoinedGallery[] }) {
  return (
    <div className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-10 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/klik-mark.png" alt="" width={32} height={32} className="rounded-[8px]" />
            <span className="text-lg font-semibold tracking-tight">klik</span>
          </Link>
          <Link href="/login?next=/me" className="text-sm text-muted hover:text-paper">
            Sign in
          </Link>
        </header>

        <h1 className="font-display text-2xl text-paper">Your galleries</h1>
        <p className="mt-2 text-sm text-muted">The events you joined on this phone.</p>

        <div className="mt-8 space-y-3">
          {galleries.map((gallery) => (
            <JoinedGalleryRow key={gallery.eventId} gallery={gallery} account={false} />
          ))}
        </div>

        <Card className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium text-paper">Keep them on every phone</h2>
              <p className="mt-1 max-w-sm text-xs text-muted">
                Sign in with your email and these galleries are saved to your account, so you can find them
                from any phone, even if this browser forgets them.
              </p>
            </div>
            <Link href="/login?next=/me" className={buttonClassName({ size: "sm" })}>
              Sign in
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
