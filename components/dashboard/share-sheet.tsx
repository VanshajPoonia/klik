"use client";

import { useEffect, useRef, useState } from "react";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { selectClass } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { ShareLinkRow } from "@/components/dashboard/share-link-row";
import { ShareSettingsEditor } from "@/components/dashboard/share-settings-editor";
import { useShareLinks } from "@/components/dashboard/use-share-links";
import { EXPIRY_OPTIONS, MAX_SELECTION_SHARE_ITEMS, VIEW_LIMIT_OPTIONS, shareState } from "@/lib/share-access";

/** What a share sheet makes links to. */
export type ShareTarget =
  | { scope: "media"; mediaId: string; kind: "photo" | "video" }
  | { scope: "album"; albumId: string; name: string }
  | { scope: "selection"; mediaIds: string[] };

/** The words for a target, in the heading and in the line under it. */
function wording(target: ShareTarget): { heading: string; noun: string; reach: string } {
  if (target.scope === "album") {
    return {
      heading: `Share ${target.name}`,
      noun: "this folder",
      reach:
        "A link shows what is in this folder and the folders inside it, including photos added later. Photos you hid stay hidden.",
    };
  }
  if (target.scope === "selection") {
    const count = `${target.mediaIds.length} ${target.mediaIds.length === 1 ? "photo" : "photos"}`;
    return {
      heading: `Share ${count}`,
      noun: `these ${count}`,
      reach: `A link shows these ${count} and nothing added later. Links made before are on the Links tab.`,
    };
  }
  return { heading: `Share this ${target.kind}`, noun: `this ${target.kind}`, reach: "" };
}

/**
 * Share links for one photo, one folder or a selection: what exists, and a
 * way to make another.
 *
 * Several links per photo rather than one, because the second link is the point.
 * A host sends a photo to the couple with downloads on and no expiry, and the
 * same photo to a group chat with a one-week expiry. One link per photo would
 * force those two audiences to share one set of rules, and the only way to
 * tighten it for one would be to break it for the other.
 */
export function ShareSheet({
  eventId,
  target,
  onClose,
}: {
  eventId: string;
  target: ShareTarget;
  onClose: () => void;
}) {
  const { shares, loading, error, busyIds, create, revoke, update } = useShareLinks(
    eventId,
    target.scope === "media"
      ? { mediaId: target.mediaId }
      : target.scope === "album"
        ? { albumId: target.albumId }
        : { madeHere: true },
  );
  const words = wording(target);
  const tooMany = target.scope === "selection" && target.mediaIds.length > MAX_SELECTION_SHARE_ITEMS;

  const [expiresInDays, setExpiresInDays] = useState<number | null>(null);
  const [maxViews, setMaxViews] = useState<number | null>(null);
  const [allowDownload, setAllowDownload] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes, and focus starts inside the dialog, stays there, and
  // returns to whatever opened it (TRS-3). Same contract as the lightbox.
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, { initial: closeRef });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleCreate() {
    setCreating(true);
    const created = await create({
      ...(target.scope === "media"
        ? { mediaId: target.mediaId }
        : target.scope === "album"
          ? { albumId: target.albumId }
          : { mediaIds: target.mediaIds }),
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
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Share links for ${words.noun}`}
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-canvas-line bg-canvas-raised p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl text-paper">{words.heading}</h2>
            <p className="mt-1 text-xs text-muted">
              {liveCount === 0
                ? "No links yet. Anyone with a link can open it, so keep it to the people you mean."
                : `${liveCount} ${liveCount === 1 ? "link is" : "links are"} live. Anyone holding one can open ${words.noun}.`}
            </p>
            {words.reach && <p className="mt-1.5 text-xs text-muted">{words.reach}</p>}
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
            hint={
              target.scope === "media"
                ? "Off means they can look at it but not save a copy."
                : "Off means they can look but not save copies. On, they can also download everything as a ZIP."
            }
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
            disabled={creating || tooMany || (usePassword && password.length < 4)}
            className="w-full"
          >
            {creating ? "Creating" : "Create link"}
          </Button>
          {tooMany && (
            <p className="text-xs text-muted" role="status">
              One link holds up to {MAX_SELECTION_SHARE_ITEMS} photos. Move these into a folder and share the folder
              instead.
            </p>
          )}
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
