"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Smartphone, X } from "lucide-react";
import { useGuestCopy } from "@/components/guest/guest-copy";
import { FROM_HOME_SCREEN, homeScreenPlatform, type HomeScreenPlatform } from "@/lib/home-screen";

const storageKey = (eventId: string) => `klik:home-screen:${eventId}`;

/** Which steps to show here, or "none": a computer, already added, or waved away. */
function current(eventId: string): HomeScreenPlatform | "none" {
  if (new URLSearchParams(window.location.search).get("from") === FROM_HOME_SCREEN) return "none";
  try {
    if (window.localStorage.getItem(storageKey(eventId))) return "none";
  } catch {
    // Storage blocked: offered every visit, which is the lesser harm.
  }
  const touchMac = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
  return homeScreenPlatform(navigator.userAgent, touchMac) ?? "none";
}

const noSubscription = () => () => {};

/**
 * Offers to put the gallery on the guest's home screen, with the steps for
 * their phone, because no browser will do it for a page by itself. Gone for
 * good once they open the gallery from the icon, or say not now.
 */
export function AddToHomeScreen({ eventId }: { eventId: string }) {
  const { t } = useGuestCopy();
  const platform = useSyncExternalStore(noSubscription, () => current(eventId), () => "none" as const);
  const [dismissed, setDismissed] = useState(false);

  // Opened from the icon: remembered, and the marker taken out of the address
  // so a link copied from here is the plain gallery link.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("from") !== FROM_HOME_SCREEN) return;
    try {
      window.localStorage.setItem(storageKey(eventId), "added");
    } catch {
      // Nothing to remember it in.
    }
    url.searchParams.delete("from");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [eventId]);

  if (platform === "none" || dismissed) return null;

  const steps = { ios: t.home.ios, android: t.home.android, samsung: t.home.samsung, "in-app": t.home.inApp }[platform];
  return (
    <section
      aria-label={t.home.title}
      className="klik-fade-in mb-6 flex items-start gap-3 rounded-2xl border border-canvas-line bg-canvas-raised p-4"
    >
      <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-volt" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-paper">{t.home.title}</p>
        <p className="mt-0.5 text-xs text-muted">
          {t.home.body} {steps}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
          try {
            window.localStorage.setItem(storageKey(eventId), "dismissed");
          } catch {
            // Gone for this visit only.
          }
        }}
        aria-label={t.home.dismiss}
        title={t.home.dismiss}
        className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </section>
  );
}
