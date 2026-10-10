"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { Flag, Heart, MessageCircle, X } from "lucide-react";
import { timeAgo } from "@/lib/time-ago";
import { useGuestCopy } from "@/components/guest/guest-copy";

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

/** Mirrors COMMENT_REPORT_LABELS in lib/comments.ts. The words are in lib/i18n/guest.ts (TRS-3). */
const COMMENT_REPORT_OPTIONS: CommentReportReason[] = ["harassment", "nudity", "privacy", "spam", "child_safety", "other"];

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
  const { t } = useGuestCopy();
  if (!onToggle) {
    return (
      <span className="flex min-h-11 items-center gap-2 px-2 text-sm tabular-nums text-muted">
        <Heart className="h-5 w-5" aria-hidden="true" />
        <span>
          {count} <span className="sr-only">{t.social.hearts(count)}</span>
        </span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={reacted}
      aria-label={reacted ? t.social.removeHeart(kind) : t.social.heart(kind)}
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
  const { t } = useGuestCopy();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t.social.commentsLabel(count)}
      className={chip}
    >
      <MessageCircle className="h-5 w-5" aria-hidden="true" />
      {count > 0 && <span aria-hidden="true">{count}</span>}
    </button>
  );
}


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
  const { t, locale } = useGuestCopy();
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
      setLoadError(t.social.loadFailedOffline);
      return;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setLoadError(body.error ?? t.social.loadFailed);
      return;
    }
    setLoadError(null);
    setSignedIn(Boolean(body.signedIn));
    apply(body.comments ?? []);
  }, [apply, base, t]);

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
      setSendError(t.social.sendFailedOffline);
      return;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (body.signIn) setSignedIn(false);
      setSendError(body.error ?? t.social.sendFailed);
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
      setActionError({ id: comment.id, message: body.error ?? t.social.actionFailed });
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
      aria-label={t.social.sheet(kind)}
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
          aria-label={t.social.closeComments}
          className="flex h-11 w-11 items-center justify-center rounded-full text-paper"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <ul ref={listRef} className="min-h-24 flex-1 space-y-4 overflow-y-auto px-4 py-3" aria-live="polite">
        {comments === null && !loadError && <li className="text-sm text-muted">{t.social.loading}</li>}
        {loadError && (
          <li className="text-sm text-red-400" role="alert">
            {loadError}
          </li>
        )}
        {comments?.length === 0 && (
          <li className="text-sm text-muted">{t.social.none}</li>
        )}
        {comments?.map((comment) => {
          const busy = busyId === comment.id;
          const hiddenLabel = comment.hidden
            ? canModerate
              ? t.social.hiddenTeam[comment.hidden]
              : t.social.hiddenAuthor[comment.hidden]
            : null;
          return (
            <li key={comment.id} className={comment.hidden ? "opacity-60" : undefined}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium text-paper">{comment.author.name}</span>
                {comment.author.team && (
                  <span className="rounded-full bg-volt px-1.5 py-px text-[10px] font-medium text-on-volt">{t.social.host}</span>
                )}
                {now !== null && (
                  <time dateTime={comment.createdAt} className="text-xs text-muted">
                    {(() => {
                      const ago = timeAgo(comment.createdAt, now, locale === "es" ? "es-US" : "en-US");
                      return ago === "now" ? t.social.justNow : ago;
                    })()}
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
                  {t.social.reportedBy(comment.openReports)}
                </p>
              ) : null}

              <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted">
                {comment.mine && (
                  <button type="button" disabled={busy} onClick={() => void remove(comment)} className="min-h-8 underline-offset-2 hover:text-paper hover:underline">
                    {t.social.delete}
                  </button>
                )}
                {canModerate && !comment.mine && !comment.hidden && (
                  <button type="button" disabled={busy} onClick={() => void moderate(comment, "hide")} className="min-h-8 underline-offset-2 hover:text-paper hover:underline">
                    {t.social.hide}
                  </button>
                )}
                {canModerate && !comment.hidden && comment.openReports ? (
                  <button type="button" disabled={busy} onClick={() => void moderate(comment, "show")} className="min-h-8 underline-offset-2 hover:text-paper hover:underline">
                    {t.social.keepUp}
                  </button>
                ) : null}
                {canModerate && comment.hidden && comment.hidden !== "klik" && !comment.safetyHold && (
                  <button type="button" disabled={busy} onClick={() => void moderate(comment, "show")} className="min-h-8 underline-offset-2 hover:text-paper hover:underline">
                    {t.social.showAgain}
                  </button>
                )}
                {!canModerate && !comment.mine && !comment.hidden && !reportedIds.has(comment.id) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setReporting({ id: comment.id, reason: null })}
                    className="min-h-8 underline-offset-2 hover:text-paper hover:underline"
                  >
                    {t.social.report}
                  </button>
                )}
                {reportedIds.has(comment.id) && <span className="min-h-8 leading-8">{t.social.reported}</span>}
              </div>

              {reporting?.id === comment.id && (
                <fieldset className="mt-2 space-y-1 rounded-xl border border-white/10 p-3">
                  <legend className="px-1 text-xs text-muted">{t.social.whatIsWrong}</legend>
                  {COMMENT_REPORT_OPTIONS.map((value) => (
                    <label key={value} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm text-paper hover:bg-white/5">
                      <input
                        type="radio"
                        name={`report-${comment.id}`}
                        checked={reporting.reason === value}
                        onChange={() => setReporting({ id: comment.id, reason: value })}
                        className="accent-[var(--color-volt)]"
                      />
                      {t.social.reasons[value]}
                    </label>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      disabled={!reporting.reason || busy}
                      onClick={() => reporting.reason && void report(comment, reporting.reason)}
                      className="min-h-10 rounded-full bg-volt px-4 text-sm font-medium text-on-volt disabled:opacity-50"
                    >
                      {busy ? t.social.sending : t.social.report}
                    </button>
                    <button
                      type="button"
                      onClick={() => setReporting(null)}
                      className="min-h-10 rounded-full border border-white/15 px-4 text-sm text-paper"
                    >
                      {t.common.cancel}
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
              {t.social.addComment}
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
              placeholder={t.social.addComment}
              rows={Math.min(4, Math.max(1, draft.split("\n").length))}
              maxLength={MAX_LENGTH}
              className="min-h-11 flex-1 resize-none rounded-2xl border border-white/15 bg-transparent px-3 py-2.5 text-sm text-paper placeholder:text-muted focus:border-volt/60 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending}
              className="min-h-11 shrink-0 rounded-full bg-volt px-4 text-sm font-medium text-on-volt disabled:opacity-50"
            >
              {sending ? t.social.sending : t.social.send}
            </button>
          </form>
        ) : (
          <p className="text-sm text-muted">
            {t.social.needAccount}{" "}
            {signInHref && (
              <a href={signInHref} className="text-paper underline underline-offset-2">
                {t.social.signIn}
              </a>
            )}
          </p>
        )}
        {signedIn && remaining <= 60 && (
          <p className="mt-1 text-right text-xs tabular-nums text-muted">{t.social.charactersLeft(remaining)}</p>
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
