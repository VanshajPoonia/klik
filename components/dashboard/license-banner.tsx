"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button, buttonClassName } from "@/components/ui/button";
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "@/lib/support";

export interface EventLicenseSummary {
  state: "draft" | "live" | "lapsed";
  /** Something the account already holds that would put this live right now. */
  canGoLive: boolean;
  /** Formatted on the server, so it renders the same on both sides. */
  requestedAt: string | null;
}

/**
 * ACT-3: what a draft or lapsed event is waiting for, and the one thing that
 * moves it on. Never a dead end: there is always a next step on screen, and
 * the step names who is doing what.
 *
 * Rendered nowhere for a live event. Its absence is the signal.
 */
export function LicenseBanner({ eventId, license }: { eventId: string; license: EventLicenseSummary }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"activate" | "request" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [requested, setRequested] = useState(Boolean(license.requestedAt));

  if (license.state === "live") return null;

  async function call(action: "activate" | "request") {
    setBusy(action);
    setMessage(null);
    const response = await fetch(
      `/api/events/${eventId}/${action === "activate" ? "activate" : "activation-request"}`,
      { method: "POST" },
    );
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) {
      setMessage(body.error ?? "Something went wrong. Try again, or call us.");
      return;
    }
    if (action === "request") {
      setRequested(true);
      setMessage("Sent. The Klik team has it, and you will get an email the moment it is live.");
    }
    router.refresh();
  }

  const draft = license.state === "draft";
  return (
    <Card className="mb-8 space-y-4 border-volt/30">
      <div>
        <p className="text-xs font-semibold tracking-[0.14em] text-volt uppercase">
          {draft ? "Draft" : "Not taking uploads"}
        </p>
        <h2 className="mt-2 font-display text-xl leading-tight text-paper">
          {draft ? "This event is not live yet" : "This event's plan has ended"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {draft
            ? "Set everything up now: the name, the date, the look, who can see it. Guests, uploads and the QR code switch on when it goes live."
            : "Guests can still see and download the gallery for the rest of its window. New uploads are off until a plan is added again."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {license.canGoLive ? (
          <Button onClick={() => void call("activate")} disabled={busy !== null}>
            {busy === "activate" ? "Going live…" : "Use my plan and go live"}
          </Button>
        ) : draft && !requested ? (
          <Button onClick={() => void call("request")} disabled={busy !== null}>
            {busy === "request" ? "Sending…" : "Ask Klik to activate it"}
          </Button>
        ) : (
          <Link href="/#pricing" className={buttonClassName({})}>
            {draft ? "Add a pass" : "See the plans"}
          </Link>
        )}
        <a href={SUPPORT_PHONE_HREF} className={buttonClassName({ variant: "ghost" })}>
          Call {SUPPORT_PHONE}
        </a>
      </div>

      <p className="text-xs text-muted" aria-live="polite">
        {message ??
          (requested && draft
            ? `Requested${license.requestedAt ? ` ${license.requestedAt}` : ""}. You will get an email when it is live.`
            : license.canGoLive
              ? "Your account has a plan ready for this event."
              : "Already paid? It is usually done within a day, and this page updates by itself.")}
      </p>
    </Card>
  );
}
