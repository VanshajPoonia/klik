"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import type { ThreadMessage } from "@/lib/messages";

/** How often an open conversation asks for anything new. The gallery's pace. */
const POLL_MS = 5000;

/**
 * MSG-1: one conversation, the same component on both sides. An organizer on
 * /dashboard/messages talks to Klik; a superadmin on /admin/messages talks to
 * that organizer. Polled while the tab is visible, like the gallery, so a
 * reply shows within seconds without a socket.
 *
 * Mine on the right in the accent, theirs on the left on the raised surface.
 * Nothing is optimistic: a message appears once the server has it, because a
 * bubble that later turns out not to have been sent is a promise broken in the
 * one place someone came to for help.
 */
export function Conversation({
  endpoint,
  side,
  initialMessages,
  events = [],
  emptyText,
  placeholder,
}: {
  /** GET for the thread (with ?after=), POST to send. */
  endpoint: string;
  /** Which side this person is on: their own bubbles are the ones from this side. */
  side: "account" | "klik";
  initialMessages: ThreadMessage[];
  /** The organizer's events, to say which one a message is about. */
  events?: Array<{ id: string; name: string }>;
  emptyText: string;
  placeholder: string;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [body, setBody] = useState("");
  const [eventId, setEventId] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const latest = useRef(initialMessages.at(-1)?.createdAt ?? null);

  const merge = useCallback((incoming: ThreadMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((current) => {
      const seen = new Set(current.map((message) => message.id));
      const fresh = incoming.filter((message) => !seen.has(message.id));
      return fresh.length ? [...current, ...fresh] : current;
    });
    latest.current = incoming.at(-1)?.createdAt ?? latest.current;
  }, []);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      if (document.visibilityState === "hidden") return;
      try {
        const url = latest.current ? `${endpoint}?after=${encodeURIComponent(latest.current)}` : endpoint;
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok || stopped) return;
        const data = (await response.json()) as { messages: ThreadMessage[] };
        merge(data.messages);
      } catch {
        // Offline for a moment: the next tick tries again.
      }
    }
    const timer = window.setInterval(() => void poll(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [endpoint, merge]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, ...(side === "account" && eventId ? { eventId } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not send that. Try again.");
        return;
      }
      const sent = data.message as ThreadMessage;
      merge([{ ...sent, authorName: side === "klik" ? "Klik" : null, eventName: events.find((item) => item.id === sent.eventId)?.name ?? null }]);
      setBody("");
    } catch {
      setError("Could not reach Klik. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends on a keyboard; on a phone the return key makes a new line,
    // because a thumb aiming for a line break should not send half a message.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-2" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 ? (
          <p className="mx-auto max-w-sm py-12 text-center text-sm leading-relaxed text-muted">{emptyText}</p>
        ) : (
          messages.map((message, index) => {
            const mine = side === "klik" ? message.fromKlik : !message.fromKlik;
            const previous = messages[index - 1];
            const newDay = !previous || dayOf(previous.createdAt) !== dayOf(message.createdAt);
            return (
              <div key={message.id}>
                {newDay && (
                  <p className="my-4 text-center text-xs text-muted" suppressHydrationWarning>
                    {new Date(message.createdAt).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                  </p>
                )}
                <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] sm:max-w-[70%] ${mine ? "items-end" : "items-start"} flex flex-col gap-1`}>
                    {message.eventName && (
                      <span className="rounded-full border border-canvas-line px-2.5 py-0.5 text-[11px] text-muted">
                        About {message.eventName}
                      </span>
                    )}
                    <p
                      className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                        mine ? "rounded-br-md bg-volt text-on-volt" : "rounded-bl-md border border-canvas-line bg-canvas-raised text-paper"
                      }`}
                    >
                      {message.body}
                    </p>
                    <span className="px-1 text-[11px] text-muted" suppressHydrationWarning>
                      {!mine && message.authorName ? `${message.authorName} · ` : ""}
                      {new Date(message.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="mt-3 space-y-2 border-t border-canvas-line pt-3">
        {side === "account" && events.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted">
            About
            <select
              value={eventId}
              onChange={(change) => setEventId(change.target.value)}
              className="min-h-9 max-w-[16rem] truncate rounded-full border border-canvas-line bg-canvas px-3 text-xs text-paper"
            >
              <option value="">No event in particular</option>
              {events.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex items-end gap-2">
          <label htmlFor="message-body" className="sr-only">
            Message
          </label>
          <textarea
            id="message-body"
            value={body}
            onChange={(change) => setBody(change.target.value)}
            onKeyDown={onKeyDown}
            rows={Math.min(6, Math.max(1, body.split("\n").length))}
            maxLength={4000}
            placeholder={placeholder}
            className="min-h-11 flex-1 resize-none rounded-2xl border border-canvas-line bg-canvas px-4 py-2.5 text-sm text-paper placeholder:text-muted focus:border-volt/60 focus:outline-none focus:ring-1 focus:ring-volt/60"
          />
          <button
            type="submit"
            disabled={sending || body.trim().length === 0}
            aria-label="Send"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-volt text-on-volt transition-transform active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowUp className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

function dayOf(iso: string): string {
  return new Date(iso).toDateString();
}
