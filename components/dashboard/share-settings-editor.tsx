"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { selectClass } from "@/components/ui/field";
import { EXPIRY_OPTIONS, VIEW_LIMIT_OPTIONS, type ManagedShare } from "@/lib/share-access";

/**
 * Changing a link after it has been sent, which is the part MED-3 is really
 * about: an organizer who has already pasted a link into a group chat and now
 * wants it to stop working next week, or to stop allowing downloads.
 *
 * Expiry and the open limit are shown as "leave as is" by default rather than
 * pre-filled with the current value. Pre-filling reads as harmless and is not:
 * raising an open limit resets the spent count on the server, so a form that
 * resubmits the current limit while only meaning to toggle downloads would hand
 * the views back without anyone asking for it.
 */
export function ShareSettingsEditor({
  share,
  busy,
  onSave,
}: {
  share: ManagedShare;
  busy: boolean;
  onSave: (changes: {
    allowDownload?: boolean;
    expiresInDays?: number | null;
    maxViews?: number | null;
    password?: string | null;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expiry, setExpiry] = useState<string>("keep");
  const [limit, setLimit] = useState<string>("keep");

  if (share.revokedAt) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 min-h-11 text-xs font-medium text-muted transition-colors hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
      >
        Change settings
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-2 border-t border-canvas-line pt-3">
      <label className="block">
        <span className="mb-1 block text-xs text-muted">Expiry</span>
        <select
          value={expiry}
          disabled={busy}
          onChange={(event) => {
            const next = event.target.value;
            setExpiry(next);
            if (next === "keep") return;
            onSave({ expiresInDays: next === "null" ? null : Number(next) });
          }}
          className={`${selectClass} py-2 text-xs`}
        >
          <option value="keep">Leave as is</option>
          {EXPIRY_OPTIONS.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs text-muted">Open limit</span>
        <select
          value={limit}
          disabled={busy}
          onChange={(event) => {
            const next = event.target.value;
            setLimit(next);
            if (next === "keep") return;
            onSave({ maxViews: next === "null" ? null : Number(next) });
          }}
          className={`${selectClass} py-2 text-xs`}
        >
          <option value="keep">Leave as is</option>
          {VIEW_LIMIT_OPTIONS.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <Checkbox
        checked={share.allowDownload}
        disabled={busy}
        onChange={(event) => onSave({ allowDownload: event.target.checked })}
      >
        Allow downloads
      </Checkbox>

      {share.hasPassword && (
        <button
          type="button"
          onClick={() => onSave({ password: null })}
          disabled={busy}
          className="min-h-11 text-xs font-medium text-muted transition-colors hover:text-paper disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
        >
          Remove the password
        </button>
      )}
    </div>
  );
}
