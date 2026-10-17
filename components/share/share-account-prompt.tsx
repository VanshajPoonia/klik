"use client";

import { useEffect, useState } from "react";
import { UserRound, X } from "lucide-react";

const SEEN_KEY = "klik_share_prompt_seen";

/**
 * ACC-7: once per browser, someone opening a shared link is offered an
 * account, and "Continue as a guest" is the other button, equal in size. An
 * account keeps the link on /me from any phone; nothing here needs one.
 *
 * Remembered in localStorage, which is a convenience: a private window sees it
 * again, and that is harmless. Never shown to someone already signed in.
 */
export function ShareAccountPrompt({ next }: { next: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      // Storage refused: show it, once per visit.
    }
    if (!seen) {
      const timer = window.setTimeout(() => setOpen(true), 900);
      return () => window.clearTimeout(timer);
    }
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Lasts this visit only.
    }
    setOpen(false);
  }

  if (!open) return null;
  const href = `/login?next=${encodeURIComponent(next)}`;

  return (
    <div
      role="dialog"
      aria-labelledby="share-account-title"
      className="klik-sheet-up fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md rounded-2xl border border-canvas-line bg-canvas-raised p-4 sm:bottom-6"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-volt/15 text-volt">
          <UserRound className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p id="share-account-title" className="text-sm font-medium text-paper">
            Keep this on your account?
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            Sign in or create an account with your email and it stays in Your galleries, on any phone. You can look
            without one.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close"
          className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:text-paper"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <a
          href={href}
          onClick={() => {
            try {
              window.localStorage.setItem(SEEN_KEY, "1");
            } catch {
              // Lasts this visit only.
            }
          }}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-volt px-4 text-sm font-medium text-on-volt transition-transform active:scale-[0.98]"
        >
          Sign in or sign up
        </a>
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-canvas-line px-4 text-sm text-paper transition-transform active:scale-[0.98]"
        >
          Continue as a guest
        </button>
      </div>
    </div>
  );
}
