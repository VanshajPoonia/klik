import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { GrantControl } from "@/components/admin/grant-control";
import type { getPendingSignups } from "@/lib/billing-admin";

/**
 * Who has an account and nothing to use it with, each with a grant form.
 *
 * The email is the point of this panel. A Payment Link payment lands in the
 * Stripe Dashboard with an email and nothing else, so it is shown in full and
 * as a mailto, ready to paste into Stripe's search.
 */
export function PendingSignups({
  signups,
}: {
  signups: Awaited<ReturnType<typeof getPendingSignups>>;
}) {
  if (signups.length === 0) return null;

  return (
    <Card className="mb-8 space-y-4 border-volt/30">
      <div className="flex items-center gap-2.5">
        <h2 className="font-display text-lg text-paper">Signed up, not activated</h2>
        <Badge>{signups.length}</Badge>
      </div>

      <ul className="divide-y divide-canvas-line rounded-xl border border-canvas-line">
        {signups.map((signup) => (
          <li key={signup.userId}>
            <details className="group">
              <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm transition-colors hover:bg-paper/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-volt [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="text-paper">{signup.name ?? signup.username ?? signup.userId}</span>
                  {signup.email && <span className="ml-2 break-all text-xs text-muted">{signup.email}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                  signed up {signup.createdAt.toLocaleDateString("en-GB")}
                  <span className="rounded-full bg-volt px-3 py-1 font-medium text-on-volt group-open:hidden">Grant</span>
                  <span className="hidden group-open:inline">Close</span>
                </span>
              </summary>
              <div className="space-y-3 px-4 pb-4">
                <GrantControl userId={signup.userId} events={[]} settleMs={3000} />
                <div className="flex flex-wrap gap-4 text-xs">
                  <Link href={`/admin/clients/${signup.userId}`} className="text-muted hover:text-paper">
                    Open their page
                  </Link>
                  {signup.email && (
                    <a href={`mailto:${signup.email}`} className="text-muted hover:text-volt">
                      Email {signup.email}
                    </a>
                  )}
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>

      <p className="text-xs leading-relaxed text-muted">
        They can sign in and set up drafts, and nothing goes live. Find their payment in Stripe by email, then grant
        the plan here. That activates them, puts their waiting draft live, and emails them the link to their dashboard.
      </p>
    </Card>
  );
}
