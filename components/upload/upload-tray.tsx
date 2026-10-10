"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Clock, Film, ImageIcon, Loader2, UploadCloud, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TrayItem } from "@/lib/upload-queue/page-queue";
import { useGuestCopy } from "@/components/guest/guest-copy";
import { uploadRefusalText, type GuestCopy, type UploadKind } from "@/lib/i18n/guest";

/**
 * OPS-3: what is waiting to upload from this device, and why. Every file a
 * guest picks shows here until it is in the gallery, with what is happening
 * to it in plain words: getting ready, sending, waiting for the connection,
 * or refused and why. Nothing disappears silently.
 */

/** What a set of items is, for the words about it (TRS-3: nouns agree in Spanish). */
function kindOf(items: TrayItem[]): UploadKind {
  const videos = items.filter((item) => item.kind === "video").length;
  if (videos === 0) return "photo";
  return videos === items.length ? "video" : "mixed";
}

function describe(t: GuestCopy, item: TrayItem, online: boolean): string {
  switch (item.status) {
    case "preparing":
      return t.uploads.preparing;
    case "sending":
      return item.progress === null ? t.uploads.sending : t.uploads.sendingPercent(Math.round(item.progress * 100));
    case "refused":
      return uploadRefusalText(t, item);
    default:
      return online ? t.uploads.waitingToSend : t.uploads.waitingForConnection;
  }
}

export function UploadTray({
  items,
  online,
  durable,
  onRetry,
  onRetryNow,
  onRemove,
}: {
  items: TrayItem[];
  online: boolean;
  durable: boolean;
  onRetry: (id: string) => void;
  onRetryNow: () => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useGuestCopy();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const backingOff = items.some((item) => item.status === "waiting" && item.retryAt > now);

  // A clock for the countdown, running only while something is waiting.
  useEffect(() => {
    if (!items.some((item) => item.status === "waiting")) return;
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [items]);

  if (items.length === 0) return null;

  const active = items.filter((item) => item.status !== "refused");
  const refused = items.filter((item) => item.status === "refused");
  const sending = active.filter((item) => item.status === "sending");
  const preparing = active.filter((item) => item.status === "preparing");
  const volatile = active.some((item) => item.volatile);
  const nextTry = active
    .filter((item) => item.status === "waiting" && item.retryAt > now)
    .reduce<number | null>((soonest, item) => (soonest === null || item.retryAt < soonest ? item.retryAt : soonest), null);
  const selected = items.find((item) => item.id === selectedId) ?? null;

  const kept = durable && !volatile;
  let icon = <UploadCloud className="h-4 w-4 text-volt" aria-hidden="true" />;
  let headline: string;
  let detail: string | null = kept ? t.uploads.keptDetail : t.uploads.keepOpen;
  if (active.length === 0) {
    icon = <AlertCircle className="h-4 w-4 text-red-300" aria-hidden="true" />;
    headline = t.uploads.refusedHeadline(refused.length, kindOf(refused));
    detail = null;
  } else if (!online) {
    icon = <WifiOff className="h-4 w-4 text-muted" aria-hidden="true" />;
    headline = t.uploads.offline;
    detail = kept ? t.uploads.offlineKept(active.length, kindOf(active)) : t.uploads.offlineVolatile(active.length, kindOf(active));
  } else if (sending.length > 0) {
    icon = <Loader2 className="h-4 w-4 animate-spin text-volt" aria-hidden="true" />;
    headline = t.uploads.sendingHeadline(active.length, kindOf(active));
  } else if (nextTry !== null) {
    icon = <Clock className="h-4 w-4 text-muted" aria-hidden="true" />;
    headline = t.uploads.waitingToRetry;
    detail = t.uploads.retryIn(t.uploads.wait(nextTry - now), kept, active.length, kindOf(active));
  } else if (preparing.length === active.length) {
    icon = <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden="true" />;
    headline = t.uploads.preparingHeadline(active.length, kindOf(active));
  } else {
    headline = t.uploads.waitingHeadline(active.length, kindOf(active));
  }

  return (
    <section aria-label={t.uploads.region} className="mb-6 rounded-2xl border border-canvas-line bg-canvas-raised p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5" role="status" aria-live="polite">
          <span className="mt-0.5 shrink-0">{icon}</span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-paper">{headline}</p>
            {detail && <p className="mt-0.5 text-xs text-muted">{detail}</p>}
          </div>
        </div>
        {online && backingOff && sending.length === 0 && (
          <Button variant="ghost" size="sm" onClick={onRetryNow} className="shrink-0">
            {t.uploads.tryNow}
          </Button>
        )}
      </div>

      <ul className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1" aria-label={t.uploads.files}>
        {items.map((item) => {
          const label = `${item.name}: ${describe(t, item, online)}`;
          const pressed = item.id === selectedId;
          return (
            <li key={item.id} className="shrink-0">
              <button
                type="button"
                onClick={() => setSelectedId(pressed ? null : item.id)}
                aria-pressed={pressed}
                aria-label={label}
                title={label}
                className={`relative block h-14 w-14 overflow-hidden rounded-lg border bg-canvas ${
                  item.status === "refused" ? "border-red-500/60" : pressed ? "border-volt" : "border-canvas-line"
                }`}
              >
                {item.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local object URL
                  <img
                    src={item.preview}
                    alt=""
                    className={`h-full w-full object-cover ${item.status === "sending" ? "" : "opacity-60"}`}
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                ) : null}
                <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                  {item.status === "refused" ? (
                    <AlertCircle className="h-5 w-5 text-red-300 drop-shadow" />
                  ) : item.status === "preparing" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-paper drop-shadow" />
                  ) : item.status === "waiting" ? (
                    online ? (
                      <Clock className="h-4 w-4 text-paper drop-shadow" />
                    ) : (
                      <WifiOff className="h-4 w-4 text-paper drop-shadow" />
                    )
                  ) : !item.preview ? (
                    item.kind === "video" ? (
                      <Film className="h-4 w-4 text-muted" />
                    ) : (
                      <ImageIcon className="h-4 w-4 text-muted" />
                    )
                  ) : null}
                </span>
                {item.status === "sending" && (
                  <span className="absolute inset-x-0 bottom-0 h-1 bg-canvas/70">
                    <span
                      className={`block h-full bg-volt transition-[width] duration-300 ${item.progress === null ? "w-1/3 animate-pulse" : ""}`}
                      style={item.progress === null ? undefined : { width: `${Math.max(4, Math.round(item.progress * 100))}%` }}
                    />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {selected && selected.status !== "refused" && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-canvas px-3 py-2">
          <span className="min-w-0">
            <span className="block truncate text-sm text-paper">{selected.name}</span>
            <span className="block text-xs text-muted">{describe(t, selected, online)}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onRemove(selected.id);
              setSelectedId(null);
            }}
            className="shrink-0"
          >
            {t.uploads.dontSend}
          </Button>
        </div>
      )}

      {refused.length > 0 && (
        <ul className="mt-3 max-h-60 space-y-2 overflow-y-auto" aria-label={t.uploads.couldNotBeAdded}>
          {refused.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-paper">{item.name}</span>
                <span className="block text-xs text-red-300">{uploadRefusalText(t, item)}</span>
              </span>
              <span className="flex shrink-0 gap-2">
                <Button variant="ghost" size="sm" onClick={() => onRetry(item.id)}>
                  {t.common.tryAgain}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onRemove(item.id)}>
                  {t.uploads.remove}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
