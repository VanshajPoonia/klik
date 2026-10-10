"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Gift, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

function dollars(cents: number) {
  const value = Math.abs(cents) / 100;
  const text = Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
  return cents < 0 ? `-${text}` : text;
}

/**
 * GRW-5: the account's referral link, how it is going, and the credit it has
 * earned. Credit is taken off a future payment by Klik, by hand, so this says
 * so rather than offering a button that would have to pretend.
 */
export function ReferralCard({
  link,
  creditEach,
  joined,
  qualified,
  balanceCents,
  history,
}: {
  link: string;
  creditEach: string;
  joined: number;
  qualified: number;
  balanceCents: number;
  history: Array<{ id: string; amountCents: number; reason: string; createdAt: string }>;
}) {
  const [copied, setCopied] = useState(false);
  // Known only in the browser, so asked after the first paint.
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setCanShare("share" in navigator), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The link is on screen to select by hand.
    }
  }

  async function share() {
    try {
      await navigator.share({ title: "Klik", text: "Every guest's photos in one gallery, from one QR code.", url: link });
    } catch {
      // Closed, or not supported: copying is beside it.
    }
  }

  return (
    <section id="referrals" className="space-y-4" aria-labelledby="referrals-heading">
      <div>
        <h2 id="referrals-heading" className="flex items-center gap-2 text-sm font-medium text-paper">
          <Gift className="h-4 w-4 text-volt" aria-hidden="true" />
          Invite someone running an event
        </h2>
        <p className="mt-1 max-w-lg text-xs text-muted">
          When someone signs up through your link and their first event goes live, you each get {creditEach} off a
          future purchase. Your galleries carry your link too, for guests who want one of their own.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-xl border border-canvas-line bg-canvas px-3 py-2.5 text-sm text-paper">
          {link}
        </code>
        <Button size="sm" variant="ghost" onClick={() => void copy()} aria-label="Copy your referral link">
          {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        {canShare && (
          <Button size="sm" variant="ghost" onClick={() => void share()}>
            <Share2 className="h-4 w-4" aria-hidden="true" />
            Share
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-xl border border-canvas-line px-2 py-3">
          <dt className="text-xs text-muted">Signed up</dt>
          <dd className="mt-1 font-display text-xl text-paper tabular-nums">{joined}</dd>
        </div>
        <div className="rounded-xl border border-canvas-line px-2 py-3">
          <dt className="text-xs text-muted">Went live</dt>
          <dd className="mt-1 font-display text-xl text-paper tabular-nums">{qualified}</dd>
        </div>
        <div className="rounded-xl border border-canvas-line px-2 py-3">
          <dt className="text-xs text-muted">Your credit</dt>
          <dd className="mt-1 font-display text-xl text-paper tabular-nums">{dollars(balanceCents)}</dd>
        </div>
      </dl>

      {balanceCents > 0 && (
        <p className="text-xs text-muted">We take your credit off your next payment, so there is nothing to do.</p>
      )}

      {history.length > 0 && (
        <ul className="divide-y divide-canvas-line rounded-xl border border-canvas-line text-sm" aria-label="Credit history">
          {history.map((entry) => (
            <li key={entry.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0 text-paper/85">{entry.reason}</span>
              <span className={`shrink-0 tabular-nums ${entry.amountCents < 0 ? "text-muted" : "text-paper"}`}>
                {entry.amountCents > 0 ? "+" : ""}
                {dollars(entry.amountCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
