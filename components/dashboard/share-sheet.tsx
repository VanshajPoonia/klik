"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { selectClass } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { ShareLinkRow } from "@/components/dashboard/share-link-row";
import { ShareSettingsEditor } from "@/components/dashboard/share-settings-editor";
import { useShareLinks } from "@/components/dashboard/use-share-links";
import { EXPIRY_OPTIONS, VIEW_LIMIT_OPTIONS, shareState } from "@/lib/share-access";

/**
 * Share links for one photo: what exists, and a way to make another.
 *
 * Several links per photo rather than one, because the second link is the point.
 * A host sends a photo to the couple with downloads on and no expiry, and the
 * same photo to a group chat with a one-week expiry. One link per photo would
 * force those two audiences to share one set of rules, and the only way to
 * tighten it for one would be to break it for the other.
 */
export function ShareSheet({
  eventId,
  mediaId,
  mediaKind,
  onClose,
}: {
  eventId: string;
  mediaId: string;
  mediaKind: "photo" | "video";
  onClose: () => void;
}) {
  const { shares, loading, error, busyIds, create, revoke, update } = useShareLinks(
    eventId,
    mediaId,
  );

  const [expiresInDays, setExpiresInDays] = useState<number | null>(null);
  const [maxViews, setMaxViews] = useState<number | null>(null);
  const [allowDownload, setAllowDownload] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes, and focus starts inside the dialog and returns to whatever
  // opened it. Same contract as the lightbox.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  async function handleCreate() {
    setCreating(true);
    const created = await create({
      mediaId,
      allowDownload,
      expiresInDays,
      maxViews,
      password: usePassword && password.length >= 4 ? password : null,
    });
    setCreating(false);
    if (created) {
      setPassword("");
      setUsePassword(false);
    }
  }

  const liveCount = shares.filter((share) => shareState(share) === "live").length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Share links for this ${mediaKind}`}
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-canvas-line bg-canvas-raised p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl text-paper">Share this {mediaKind}</h2>
            <p className="mt-1 text-xs text-muted">
              {liveCount === 0
                ? "No links yet. Anyone with a link can open it, so keep it to the people you mean."
                : `${liveCount} ${liveCount === 1 ? "link is" : "links are"} live. Anyone holding one can open this ${mediaKind}.`}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {error && (
          <p
            className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            role="alert"
          >
            {error}
          </p>
        )}

        <section className="space-y-2.5 rounded-xl border border-canvas-line bg-canvas p-3">
          <h3 className="text-xs font-medium tracking-wide text-muted uppercase">New link</h3>

          <label className="block">
            <span className="sr-only">When the link should stop working</span>
            <select
              value={String(expiresInDays)}
              onChange={(event) =>
                setExpiresInDays(event.target.value === "null" ? null : Number(event.target.value))
              }
              className={`${selectClass} py-2 text-xs`}
            >
              {EXPIRY_OPTIONS.map((option) => (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="sr-only">How many times the link may be opened</span>
            <select
              value={String(maxViews)}
              onChange={(event) =>
                setMaxViews(event.target.value === "null" ? null : Number(event.target.value))
              }
              className={`${selectClass} py-2 text-xs`}
            >
              {VIEW_LIMIT_OPTIONS.map((option) => (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <Checkbox
            checked={allowDownload}
            onChange={(event) => setAllowDownload(event.target.checked)}
            hint="Off means they can look at it but not save a copy."
          >
            Allow downloads
          </Checkbox>

          <Checkbox
            checked={usePassword}
            onChange={(event) => setUsePassword(event.target.checked)}
            hint="Send the password separately from the link, or it protects nothing."
          >
            Ask for a password
          </Checkbox>

          {usePassword && (
            <PasswordInput
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 4 characters"
              autoComplete="off"
              aria-label="Password for this link"
            />
          )}

          <Button
            type="button"
            size="sm"
            onClick={() => void handleCreate()}
            disabled={creating || (usePassword && password.length < 4)}
            className="w-full"
          >
            {creating ? "Creating" : "Create link"}
          </Button>
        </section>

        <section className="mt-4 space-y-2.5">
          {loading ? (
            <p className="text-xs text-muted">Loading links</p>
          ) : shares.length === 0 ? null : (
            shares.map((share) => (
              <ShareLinkRow
                key={share.id}
                share={share}
                busy={busyIds.has(share.id)}
                onRevoke={(id) => void revoke(id)}
              >
                <ShareSettingsEditor
                  share={share}
                  busy={busyIds.has(share.id)}
                  onSave={(changes) => void update(share.id, changes)}
                />
              </ShareLinkRow>
            ))
          )}
        </section>

        {/*
          Said plainly because it is the one thing about these links a host
          cannot undo, and finding out afterwards is worse. Turning a link off
          stops the page loading immediately; it does not reach into a group
          chat and remove the preview thumbnail that was already drawn there.
        */}
        <p className="mt-4 text-xs text-muted">
          Turning a link off stops it working straight away. A preview image a
          chat app already added to a conversation stays in that conversation.
        </p>
      </div>
    </div>
  );
}
