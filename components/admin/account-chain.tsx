import { Check, CircleAlert, CircleDashed, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ChainStep } from "@/lib/timeline";

/**
 * How far one customer has got, and whose turn it is.
 *
 * The list is always the same seven steps in the same order, including the ones
 * already done. A view that hid completed steps would read differently every
 * time and could not be scanned down a page of accounts, which is the one thing
 * this has to support: finding the account that is stuck.
 *
 * Only `action` is coloured. Everything incomplete looking urgent is how a panel
 * stops being read, and most incomplete steps here are somebody else's turn.
 */

const MARKERS = {
  done: { Icon: Check, className: "text-volt" },
  action: { Icon: CircleAlert, className: "text-amber-400" },
  waiting: { Icon: CircleDashed, className: "text-muted" },
  unknown: { Icon: HelpCircle, className: "text-muted/60" },
} as const;

export function AccountChain({ steps }: { steps: ChainStep[] }) {
  const done = steps.filter((step) => step.state === "done").length;
  const actions = steps.filter((step) => step.state === "action").length;

  return (
    <div className="rounded-xl border border-canvas-line">
      <div className="flex items-center justify-between gap-3 border-b border-canvas-line px-4 py-2.5">
        <p className="text-xs font-medium text-muted">
          Progress{" "}
          <span className="text-paper">
            {done} of {steps.length}
          </span>
        </p>
        {actions > 0 && (
          <Badge tone="warning">
            {actions} {actions === 1 ? "needs you" : "need you"}
          </Badge>
        )}
      </div>

      <ol className="divide-y divide-canvas-line">
        {steps.map((step) => {
          const { Icon, className } = MARKERS[step.state];
          return (
            <li key={step.key} className="flex gap-3 px-4 py-2.5">
              <Icon
                className={`mt-0.5 size-4 shrink-0 ${className}`}
                aria-hidden="true"
                strokeWidth={2.5}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p
                    className={`text-sm ${
                      step.state === "done"
                        ? "text-paper"
                        : step.state === "action"
                          ? "font-medium text-amber-400"
                          : "text-muted"
                    }`}
                  >
                    {step.label}
                  </p>
                  {step.at && (
                    <time
                      dateTime={step.at.toISOString()}
                      className="shrink-0 text-[11px] text-muted"
                    >
                      {step.at.toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                      })}
                    </time>
                  )}
                </div>
                {/* Always shown, never on hover. The note is the actionable half:
                    "search Stripe for this address" is the instruction, and the
                    label above it is only the heading. */}
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{step.note}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
