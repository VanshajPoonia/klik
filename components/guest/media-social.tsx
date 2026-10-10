"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { Flag, Heart, MessageCircle, X } from "lucide-react";
import { timeAgo } from "@/lib/time-ago";

/**
 * MED-9 on the gallery side: the heart, the comment button, and the comments
 * sheet that opens over the photo. Shared by the guest gallery's lightbox and
 * the organizer's, which differ only in what they may do.
 */

/** Mirrors `CommentView` in lib/comments.ts, which is server-only. */
export interface CommentView {
  id: string;
  body: string;
  createdAt: string;
  author: { name: string; team: boolean };
  mine: boolean;
  hidden: "host" | "reports" | "klik" | null;
  openReports?: number;
  safetyHold?: boolean;
}

type CommentReportReason = "harassment" | "nudity" | "privacy" | "spam" | "child_safety" | "other";

/** Mirrors COMMENT_REPORT_LABELS in lib/comments.ts. */
const COMMENT_REPORT_OPTIONS: Array<[CommentReportReason, string]> = [
  ["harassment", "Bullying, harassment or hate"],
  ["nudity", "Sexual or explicit"],
  ["privacy", "It's about me, and I don't want it here"],
  ["spam", "Spam or nothing to do with this event"],
  ["child_safety", "Suggests a child is being exploited or put at risk"],
  ["other", "Something else"],
];

const MAX_LENGTH = 500;
const REFRESH_MS = 20_000;

const chip =
  "flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-sm tabular-nums text-paper transition-transform active:scale-95 disabled:opacity-50";

export function HeartButton({
  kind,
  count,
  reacted,
  onToggle,
}: {
  kind: "photo" | "video";
  count: number;
  reacted: boolean;
  /** Absent where hearting is not offered: the count is shown, not a button. */
  onToggle?: () => void;
}) {
  if (!onToggle) {
    return (
      <span className="flex min-h-11 items-center gap-2 px-2 text-sm tabular-nums text-muted">
        <Heart className="h-5 w-5" aria-hidden="true" />
        <span>
          {count} <span className="sr-only">{count === 1 ? "heart" : "hearts"}</span>
        </span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={reacted}
      aria-label={reacted ? `Remove your heart from this ${kind}` : `Heart this ${kind}`}
      className={chip}
    >
      <Heart
        className={`h-5 w-5 transition-colors ${reacted ? "fill-volt text-volt" : ""}`}
        aria-hidden="true"
      />
      {count > 0 && <span aria-hidden="true">{count}</span>}
    </button>
  );
}

export function CommentButton({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={count === 0 ? "Comments" : `${count} ${count === 1 ? "comment" : "comments"}`}
      className={chip}
    >
      <MessageCircle className="h-5 w-5" aria-hidden="true" />
      {count > 0 && <span aria-hidden="true">{count}</span>}
    </button>
  );
}

const HIDDEN_LABEL: Record<NonNullable<CommentView["hidden"]>, { team: string; author: string }> = {
  host: { team: "Hidden by the team", author: "Only you can see this. The host hid it." },
  reports: { team: "Hidden after reports", author: "Only you can see this. It was hidden after reports." },
  klik: { team: "Hidden by Klik", author: "Only you can see this. Klik hid it." },
};

/**
 * One item's thread. Keyed by the item where it is used, so moving to another
 * photo starts a fresh sheet instead of showing the last one's comments.
 */
export function CommentsSheet({
  slug,
  mediaId,
  kind,
  canModerate,
  signInHref,
  onClose,
  onVisibleCountChange,
  onModerated,
}: {
  slug: string;
  mediaId: string;
  kind: "photo" | "video";
  /** The team: sees hidden comments and can hide or show them. */
  canModerate: boolean;
  /** Where to sign in to comment. The team is already signed in. */
  signInHref: string | null;
  onClose: () => void;
  /** Lets the button outside show the new count before the next sync does. */
  onVisibleCountChange?: (count: number) => void;
  /** Called after the team hides or shows one. */
  onModerated?: () => void;
}) {
  const base = `/api/e/${encodeURIComponent(slug)}/media/${encodeURIComponent(mediaId)}/comments`;
  const [comments, setComments] = useState<CommentView[] | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [reporting, setReporting] = useState<{ id: string; reason: CommentReportReason | null } | null>(null);
  const [reportedIds, setReportedIds] = useState<ReadonlySet<string>>(() => new Set());
  const listRef = useRef<HTMLUListElement>(null);
  const countCallback = useRef(onVisibleCountChange);
  useEffect(() => {
    countCallback.current = onVisibleCountChange;
  }, [onVisibleCountChange]);

  const apply = useCallback((next: CommentView[]) => {
    setComments(next);
    setNow(Date.now());
    countCallback.current?.(next.filter((comment) => !comment.hidden).length);
  }, []);

  const load = useCallback(async () => {
    const response = await fetch(base, { cache: "no-store" }).catch(() => null);
    if (!response) {
      setLoadError("Could not load comments. Check your connection.");
      return;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setLoadError(body.error ?? "Could not load comments.");
      return;
    }
    setLoadError(null);
    setSignedIn(Boolean(body.signedIn));
    apply(body.comments ?? []);
  }, [apply, base]);

  // Loaded on open and kept fresh while it stays open and the tab is visible,
  // so a conversation at the party reads as one.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    const response = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text }),
    }).catch(() => null);
    setSending(false);
    if (!response) {
      setSendError("Could not send it. Check your connection.");
      return;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (body.signIn) setSignedIn(false);
      setSendError(body.error ?? "Could not send it. Try again.");
      return;
    }
    setDraft("");
    apply([...(comments ?? []), body.comment]);
    requestAnimationFrame(() => {
      listRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
    });
  }

  async function act(comment: CommentView, request: () => Promise<Response>, onDone: () => void) {
    setBusyId(comment.id);
    setActionError(null);
    const response = await request().catch(() => null);
    setBusyId(null);
    if (!response?.ok) {
      const body = response ? await response.json().catch(() => ({})) : {};
      setActionError({ id: comment.id, message: body.error ?? "That did not work. Try again." });
      return;
    }
    onDone();
  }

  const remove = (comment: CommentView) =>
    act(
      comment,
      () => fetch(`${base}/${comment.id}`, { method: "DELETE" }),
      () => apply((comments ?? []).filter((item) => item.id !== comment.id)),
    );

  const moderate = (comment: CommentView, action: "hide" | "show") =>
    act(
      comment,
      () =>
        fetch(`${base}/${comment.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }),
      () => {
        void load();
        onModerated?.();
      },
    );

  const report = (comment: CommentView, reason: CommentReportReason) =>
    act(
      comment,
      () =>
        fetch(`${base}/${comment.id}/report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }),
      () => {
        setReporting(null);
        setReportedIds((current) => new Set(current).add(comment.id));
      },
    );

  // TRS-3: focus into the thread on open, back to the comment button on close.
  const sheetRef = useRef<HTMLDivElement>(null);
  useDialogFocus(sheetRef, { trap: false });

  const remaining = MAX_LENGTH - draft.length;

  return (
    <div
      ref={sheetRef}
      role="dialog"
      aria-label={`Comments on this ${kind}`}
      // Swipes inside the sheet scroll the thread; they must not reach the
      // viewer underneath and change the photo.
      onTouchStart={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      className="absolute inset-x-0 bottom-0 z-20 mx-auto flex max-h-[78%] w-full max-w-lg flex-col rounded-t-2xl border border-white/10 bg-black/90 backdrop-blur sm:bottom-3 sm:rounded-2xl"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 py-1 pl-4 pr-1">
        <p className="text-sm font-medium text-paper">Comments</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close comments"
          className="flex h-11 w-11 items-center justify-center rounded-full text-paper"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <ul ref={listRef} className="min-h-24 flex-1 space-y-4 overflow-y-auto px-4 py-3" aria-live="polite">
        {comments === null && !loadError && <li className="text-sm text-muted">Loading…</li>}
        {loadError && (
          <li className="text-sm text-red-400" role="alert">
            {loadError}
          </li>
        )}
        {comments?.length === 0 && (
          <li className="text-sm text-muted">No comments yet. Say something nice.</li>
        )}
        {comments?.map((comment) => {
          const busy = busyId === comment.id;
          const hiddenLabel = comment.hidden
            ? canModerate
              ? HIDDEN_LABEL[comment.hidden].team
              : HIDDEN_LABEL[comment.hidden].author
            : null;
          return (
            <li key={comment.id} className={comment.hidden ? "opacity-60" : undefined}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium text-paper">{comment.author.name}</span>
                {comment.author.team && (
                  <span className="rounded-full bg-volt px-1.5 py-px text-[10px] font-medium text-on-volt">Host</span>
                )}
                {now !== null && (
                  <time dateTime={comment.createdAt} className="text-xs text-muted">
                    {timeAgo(comment.createdAt, now)}
                  </time>
                )}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-paper/90">
                {comment.body}
              </p>
              {hiddenLabel && <p className="mt-1 text-xs text-muted">{hiddenLabel}</p>}
              {canModerate && !comment.hidden && comment.openReports ? (
                <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
                  <Flag className="h-3 w-3" aria-hidden="true" />
                  Reported{comment.openReports > 1 ? ` by ${comment.openReports}` : ""}
                </p>
              ) : null}

              <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted">
                {comment.mine && (
                  <button type="button" disabled={busy} onClick={() => void remove(comment)} className="min-h-8 underline-offset-2 hover:text-paper hover:underline">
                    Delete
                  </button>
                )}
                {canModerate && !comment.mine && !comment.hidden && (
                  <button type="button" disabled={busy} onClick={() => void moderate(comment, "hide")} className="min-h-8 underline-offset-2 hover:text-paper hover:underline">
                    Hide
                  </button>
                )}
                {canModerate && !comment.hidden && comment.openReports ? (
                  <button type="button" disabled={busy} onClick={() => void moderate(comment, "show")} className="min-h-8 underline-offset-2 hover:text-paper hover:underline">
                    Keep it up
                  </button>
                ) : null}
                {canModerate && comment.hidden && comment.hidden !== "klik" && !comment.safetyHold && (
                  <button type="button" disabled={busy} onClick={() => void moderate(comment, "show")} className="min-h-8 underline-offset-2 hover:text-paper hover:underline">
                    Show again
                  </button>
                )}
                {!canModerate && !comment.mine && !comment.hidden && !reportedIds.has(comment.id) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setReporting({ id: comment.id, reason: null })}
                    className="min-h-8 underline-offset-2 hover:text-paper hover:underline"
                  >
                    Report
                  </button>
                )}
                {reportedIds.has(comment.id) && <span className="min-h-8 leading-8">Reported. Thanks.</span>}
              </div>

              {reporting?.id === comment.id && (
                <fieldset className="mt-2 space-y-1 rounded-xl border border-white/10 p-3">
                  <legend className="px-1 text-xs text-muted">What is wrong with it?</legend>
                  {COMMENT_REPORT_OPTIONS.map(([value, label]) => (
                    <label key={value} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm text-paper hover:bg-white/5">
                      <input
                        type="radio"
                        name={`report-${comment.id}`}
                        checked={reporting.reason === value}
                        onChange={() => setReporting({ id: comment.id, reason: value })}
                        className="accent-[var(--color-volt)]"
                      />
                      {label}
                    </label>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      disabled={!reporting.reason || busy}
                      onClick={() => reporting.reason && void report(comment, reporting.reason)}
                      className="min-h-10 rounded-full bg-volt px-4 text-sm font-medium text-on-volt disabled:opacity-50"
                    >
                      {busy ? "Sending…" : "Report"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setReporting(null)}
                      className="min-h-10 rounded-full border border-white/15 px-4 text-sm text-paper"
                    >
                      Cancel
                    </button>
                  </div>
                </fieldset>
              )}
              {actionError?.id === comment.id && (
                <p className="mt-1 text-xs text-red-400" role="alert">
                  {actionError.message}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="shrink-0 border-t border-white/10 p-3">
        {signedIn ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label className="sr-only" htmlFor={`comment-${mediaId}`}>
              Add a comment
            </label>
            <textarea
              id={`comment-${mediaId}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, MAX_LENGTH))}
              onKeyDown={(event) => {
                // Enter sends on a keyboard; Shift+Enter is a new line. On a
                // phone the return key is a new line, and Send is right there.
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder="Add a comment"
              rows={Math.min(4, Math.max(1, draft.split("\n").length))}
              maxLength={MAX_LENGTH}
              className="min-h-11 flex-1 resize-none rounded-2xl border border-white/15 bg-transparent px-3 py-2.5 text-sm text-paper placeholder:text-muted focus:border-volt/60 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending}
              className="min-h-11 shrink-0 rounded-full bg-volt px-4 text-sm font-medium text-on-volt disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </form>
        ) : (
          <p className="text-sm text-muted">
            Comments need a free account, so everyone knows who is talking.{" "}
            {signInHref && (
              <a href={signInHref} className="text-paper underline underline-offset-2">
                Sign in with your email
              </a>
            )}
          </p>
        )}
        {signedIn && remaining <= 60 && (
          <p className="mt-1 text-right text-xs tabular-nums text-muted">{remaining} left</p>
        )}
        {sendError && (
          <p className="mt-1 text-xs text-red-400" role="alert">
            {sendError}
          </p>
        )}
      </div>
    </div>
  );
}
