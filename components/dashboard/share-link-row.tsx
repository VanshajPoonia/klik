"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy, Share2, Link2Off } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { shareState, type ManagedShare } from "@/lib/share-access";

/**
 * One share link, as the organizer sees it.
 *
 * Shared by the per-photo sheet and the event-wide Links tab so the two cannot
 * drift into describing the same link differently, which for a list whose job is
 * answering "did I turn that off?" would be the whole failure.
 */

const STATE_TONE: Record<ReturnType<typeof shareState>, "volt" | "neutral" | "warning"> = {
  live: "volt",
  revoked: "neutral",
  expired: "neutral",
  exhausted: "warning",
};

const STATE_LABEL: Record<ReturnType<typeof shareState>, string> = {
  live: "live",
  revoked: "turned off",
  expired: "expired",
  exhausted: "limit reached",
};

/**
 * Whether this device has a real OS share sheet.
 *
 * Read through `useSyncExternalStore` rather than set from an effect, so the
 * server and the first client render agree and the button does not flip label
 * after hydration. `navigator.share` is typed as always present, so the check
 * has to be for the function rather than for the property.
 */
const subscribeNever = () => () => {};
const hasDeviceShare = () =>
  typeof navigator !== "undefined" && typeof navigator.share === "function";
const noDeviceShareOnServer = () => false;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** The settings line, assembled from whatever is actually set. */
function describe(share: ManagedShare): string {
  const parts: string[] = [];
  parts.push(
    share.maxViews == null
      ? `opened ${share.viewCount} ${share.viewCount === 1 ? "time" : "times"}`
      : `${share.viewCount} of ${share.maxViews} opens used`,
  );
  if (share.expiresAt) parts.push(`expires ${formatDate(share.expiresAt)}`);
  if (share.hasPassword) parts.push("password");
  parts.push(share.allowDownload ? "downloads on" : "downloads off");
  return parts.join(" · ");
}

export function ShareLinkRow({
  share,
  onRevoke,
  busy = false,
  children,
}: {
  share: ManagedShare;
  onRevoke?: (shareId: string) => void;
  busy?: boolean;
  /** Extra controls, such as the settings editor. */
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const deviceShare = useSyncExternalStore(
    subscribeNever,
    hasDeviceShare,
    noDeviceShareOnServer,
  );
  const state = shareState(share);

  /**
   * The device share sheet first, clipboard second.
   *
   * On a phone `navigator.share` opens the real OS sheet, which is how one of
   * these links actually reaches WhatsApp: the host is standing at the event
   * holding the photo, not sitting at a desk pasting URLs. On a desktop, or
   * wherever the API is absent, copying is the same action by other means.
   */
  async function handleShare() {
    setCopyFailed(false);

    if (deviceShare) {
      try {
        await navigator.share({ url: share.url });
        return;
      } catch {
        // Dismissing the OS sheet rejects, which is not a failure and must not
        // be reported as one. Fall through to the clipboard either way: it is
        // harmless, and it is the right outcome if the sheet actually broke.
      }
    }

    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is blocked on insecure origins and by some policies.
      // The link is in a selectable input right there, so say so rather than
      // failing silently on the one action this whole screen exists for.
      setCopyFailed(true);
    }
  }

  return (
    <div className="rounded-xl border border-canvas-line bg-canvas p-3" aria-busy={busy}>
      <div className="flex items-center justify-between gap-2">
        <Badge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Badge>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleShare()}
            className="flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-paper transition-colors hover:text-volt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-volt" aria-hidden="true" />
            ) : deviceShare ? (
              <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Share"}
          </button>
          {onRevoke && state !== "revoked" && (
            <button
              type="button"
              onClick={() => onRevoke(share.id)}
              disabled={busy}
              className="flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-red-300 transition-colors hover:text-red-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
            >
              <Link2Off className="h-3.5 w-3.5" aria-hidden="true" />
              Turn off
            </button>
          )}
        </div>
      </div>

      {/* Readonly rather than plain text: a blocked clipboard still leaves the
          link selectable, and on a phone a tap selects the whole thing. */}
      <input
        readOnly
        value={share.url}
        onFocus={(event) => event.currentTarget.select()}
        aria-label="Share link address"
        className={`mt-2.5 w-full rounded-lg border border-canvas-line bg-canvas-raised px-2.5 py-2 font-mono text-xs text-muted focus:border-volt/60 focus:outline-none ${
          state === "live" ? "" : "line-through"
        }`}
      />

      {copyFailed && (
        <p className="mt-1.5 text-xs text-amber-400" role="alert">
          Could not reach the clipboard. Select the link above and copy it by hand.
        </p>
      )}

      <p className="mt-2 text-xs text-muted">{describe(share)}</p>

      {children}
    </div>
  );
}
