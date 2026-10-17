"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import type { InviteResult, InviteSummary } from "@/lib/share-invites";

/** The words, from the dashboard's English or the guest's language. */
export interface InviteCopy {
  /** "Anyone with the link can open it." */
  anyone: string;
  /** "Only the 3 people you invited can open it." */
  onlyThem: (count: number) => string;
  /** "Send it to particular people" */
  start: string;
  /** "Who it is for" */
  manage: string;
  label: string;
  hint: string;
  invite: string;
  inviting: string;
  none: string;
  opened: string;
  waiting: string;
  notEmailed: string;
  remove: (email: string) => string;
  openToAnyone: string;
  sent: (count: number) => string;
  unsent: (emails: string) => string;
  already: (count: number) => string;
  invalid: (emails: string) => string;
  full: (count: number) => string;
  failed: string;
  /** For a route's `code`, in the reader's language. */
  errors?: Partial<Record<string, string>>;
}

export interface InvitesPayload {
  inviteOnly: boolean;
  invites: InviteSummary[];
  result?: InviteResult;
  invalid?: string[];
}

/**
 * MED-14: who a share link is for. Collapsed to one line until asked, so a
 * list of links does not fetch every link's people; opened, it lists them,
 * takes more addresses, and can hand the link back to anyone holding it.
 * The same for a host's link and a guest's, with the words and the route
 * passed in.
 */
export function InvitePeople<T extends InvitesPayload = InvitesPayload>({
  endpoint,
  copy,
  inviteOnly: initialInviteOnly,
  inviteCount,
  startOpen = false,
  onChange,
}: {
  endpoint: string;
  copy: InviteCopy;
  inviteOnly: boolean;
  inviteCount: number;
  startOpen?: boolean;
  /** The route's answer after a change, for a list that shows the link. */
  onChange?: (data: T) => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [loaded, setLoaded] = useState<InviteSummary[] | null>(null);
  const [inviteOnly, setInviteOnly] = useState(initialInviteOnly);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const count = loaded?.length ?? inviteCount;

  async function call(init?: RequestInit, query = ""): Promise<T | null> {
    try {
      const response = await fetch(`${endpoint}${query}`, {
        cache: "no-store",
        ...init,
        headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const invalid = Array.isArray(data.invalid) && data.invalid.length ? ` ${copy.invalid(data.invalid.join(", "))}` : "";
        setNote({ error: true, text: `${(data.code && copy.errors?.[data.code]) || data.error || copy.failed}${invalid}` });
        return null;
      }
      setLoaded(data.invites);
      setInviteOnly(data.inviteOnly);
      onChange?.(data as T);
      return data as T;
    } catch {
      setNote({ error: true, text: copy.failed });
      return null;
    }
  }

  async function expand() {
    setOpen(true);
    if (loaded === null && initialInviteOnly) await call();
  }

  // Opened from the start on a link that already has people: list them.
  const fetchedOnOpen = useRef(false);
  useEffect(() => {
    if (!startOpen || !initialInviteOnly || fetchedOnOpen.current) return;
    fetchedOnOpen.current = true;
    void call();
    // Once, on mount; `call` is stable enough for that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function invite() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setNote(null);
    const data = await call({ method: "POST", body: JSON.stringify({ emails: text }) });
    setBusy(false);
    if (!data?.result) return;
    const { sent, unsent, already, full } = data.result;
    const parts = [
      sent.length ? copy.sent(sent.length) : null,
      unsent.length ? copy.unsent(unsent.join(", ")) : null,
      already.length ? copy.already(already.length) : null,
      full.length ? copy.full(full.length) : null,
      data.invalid?.length ? copy.invalid(data.invalid.join(", ")) : null,
    ].filter(Boolean);
    setNote({ error: unsent.length > 0 || full.length > 0, text: parts.join(" ") });
    setText("");
  }

  if (!open) {
    return (
      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted">
        <span>{inviteOnly ? copy.onlyThem(count) : copy.anyone}</span>
        <button
          type="button"
          onClick={() => void expand()}
          className="inline-flex min-h-11 items-center font-medium text-paper underline underline-offset-2 transition-colors hover:text-volt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
        >
          {inviteOnly ? copy.manage : copy.start}
        </button>
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-3 border-t border-canvas-line pt-3">
      <p className="text-xs text-muted">{inviteOnly ? copy.onlyThem(count) : copy.anyone}</p>

      {inviteOnly && loaded !== null && (
        loaded.length === 0 ? (
          <p className="text-xs text-muted">{copy.none}</p>
        ) : (
          <ul className="divide-y divide-canvas-line rounded-xl border border-canvas-line">
            {loaded.map((person) => (
              <li key={person.id} className="flex items-center justify-between gap-2 py-1 pl-3 pr-1">
                <span className="min-w-0">
                  <span className="block truncate text-xs text-paper">{person.email}</span>
                  <span className="block text-[11px] text-muted">
                    {person.opened ? copy.opened : person.emailed ? copy.waiting : copy.notEmailed}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={copy.remove(person.email)}
                  onClick={async () => {
                    setBusy(true);
                    setNote(null);
                    await call({ method: "DELETE" }, `?inviteId=${encodeURIComponent(person.id)}`);
                    setBusy(false);
                  }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-paper disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      <form
        className="space-y-2"
        onSubmit={(submit) => {
          submit.preventDefault();
          void invite();
        }}
      >
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{copy.label}</span>
          <textarea
            value={text}
            onChange={(change) => setText(change.target.value)}
            rows={2}
            maxLength={10_000}
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="ana@example.com, bo@example.com"
            className={`${inputClass} min-h-11 resize-y py-2 text-sm`}
          />
          <span className="mt-1 block text-[11px] leading-relaxed text-muted">{copy.hint}</span>
        </label>
        <Button type="submit" size="sm" disabled={busy || text.trim().length === 0}>
          {busy ? copy.inviting : copy.invite}
        </Button>
      </form>

      {note && (
        <p className={`text-xs leading-relaxed ${note.error ? "text-red-400" : "text-paper"}`} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}

      {inviteOnly && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setNote(null);
            await call({ method: "PATCH", body: JSON.stringify({ inviteOnly: false }) });
            setBusy(false);
          }}
          className="inline-flex min-h-11 items-center text-xs text-muted underline underline-offset-2 transition-colors hover:text-paper disabled:opacity-50"
        >
          {copy.openToAnyone}
        </button>
      )}
    </div>
  );
}
