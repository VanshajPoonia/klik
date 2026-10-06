import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { getPendingSignups } from "@/lib/billing-admin";

/**
 * Who has an account and nothing to use it with.
 *
 * Read-only on purpose, the same way `PendingActivations` is: granting happens
 * through the plan control further down the page, so there is one way to do it
 * rather than two that can disagree.
 *
 * The email is the point of this panel. A Payment Link payment lands in the
 * Stripe Dashboard with an email and nothing else, and matching it to an account
 * by hand is impossible if the account is not listed anywhere, which is exactly
 * what a signup with no event and no plan used to be.
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

      <ul className="space-y-2">
        {signups.map((signup) => (
          <li
            key={signup.userId}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-canvas-line pt-2 text-sm"
          >
            <span className="min-w-0">
              <span className="text-paper">{signup.name ?? signup.username ?? signup.userId}</span>
              {signup.email && (
                // Selectable, and a mailto, because the next thing done with
                // this value is pasting it into Stripe's search box or writing
                // to the person.
                <a
                  href={`mailto:${signup.email}`}
                  className="ml-2 break-all text-xs text-muted hover:text-volt"
                >
                  {signup.email}
                </a>
              )}
            </span>
            <span className="shrink-0 text-xs text-muted">
              signed up {signup.createdAt.toLocaleDateString("en-GB")}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-xs leading-relaxed text-muted">
        These accounts can sign in and cannot create an event. Find their payment in Stripe by
        email, then assign the plan below, which activates them.
      </p>
    </Card>
  );
}
