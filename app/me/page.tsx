import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { and, count, eq, isNull, or } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { eventCoHosts, events } from "@/lib/schema";
import { claimGuestCookies, joinedGalleries } from "@/lib/guest-accounts";
import { Card } from "@/components/ui/card";
import { buttonClassName } from "@/components/ui/button";
import { JoinedGalleryRow } from "@/components/me/joined-gallery-row";

export const metadata: Metadata = { title: "Your galleries", robots: { index: false } };

/**
 * ACC-4: the account as a guest sees it. The galleries you joined, from any
 * phone you joined them on while signed in, and from this phone's anonymous
 * visits, which are claimed on the way in.
 */
export default async function MePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/me");
  const userId = session.user.id;

  // ACC-3. Idempotent, so reloading the page is harmless.
  await claimGuestCookies(userId, (await cookies()).getAll());

  const [galleries, [hosting]] = await Promise.all([
    joinedGalleries(userId),
    db
      .select({ n: count() })
      .from(events)
      .leftJoin(eventCoHosts, and(eq(eventCoHosts.eventId, events.id), eq(eventCoHosts.userId, userId), isNull(eventCoHosts.deletedAt)))
      .where(and(isNull(events.deletedAt), or(eq(events.ownerId, userId), eq(eventCoHosts.userId, userId)))),
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
