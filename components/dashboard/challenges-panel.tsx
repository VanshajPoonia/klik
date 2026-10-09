"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trophy, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { inputClass } from "@/components/ui/field";
import { MAX_CHALLENGES, MAX_PROMPT_LENGTH, SUGGESTED_PROMPTS } from "@/lib/challenge-limits";

interface Row {
  /** Null until saved. A saved one keeps its id, and with it its photos. */
  id: string | null;
  prompt: string;
  key: string;
}

let keySequence = 0;
const nextKey = () => `row-${(keySequence += 1)}`;

/**
 * GRW-3: the host's photo challenges. Prompts guests see as cards in the
 * gallery, in this order, and the leaderboard switch. Saving stamps the event,
 * so galleries already open pick the change up at their next sync.
 */
export function ChallengesPanel({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [leaderboard, setLeaderboard] = useState(false);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/events/${eventId}/challenges`)
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) {
          setMessage(body.error ?? "Challenges could not be loaded.");
          return;
        }
        setRows((body.challenges as Array<{ id: string; prompt: string }>).map((row) => ({ ...row, key: nextKey() })));
        setLeaderboard(Boolean(body.leaderboard));
      })
      .catch(() => !cancelled && setMessage("Challenges could not be loaded."));
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const change = (next: Row[]) => {
    setRows(next);
    setDirty(true);
    setMessage(null);
  };

  const add = (prompt: string) => {
    const clean = prompt.replace(/\s+/g, " ").trim().slice(0, MAX_PROMPT_LENGTH);
    if (!clean || !rows || rows.length >= MAX_CHALLENGES) return;
    if (rows.some((row) => row.prompt.toLowerCase() === clean.toLowerCase())) return;
    change([...rows, { id: null, prompt: clean, key: nextKey() }]);
  };

  const move = (index: number, by: -1 | 1) => {
    if (!rows) return;
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row);
    change(next);
  };

  async function save() {
    if (!rows) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/events/${eventId}/challenges`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenges: rows.map(({ id, prompt }) => ({ id, prompt })), leaderboard }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "They could not be saved.");
      setRows((body.challenges as Array<{ id: string; prompt: string }>).map((row) => ({ ...row, key: nextKey() })));
      setDirty(false);
      setMessage("Saved. Guests see them the next time their gallery checks in.");
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "They could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const suggestions = rows
    ? SUGGESTED_PROMPTS.filter((prompt) => !rows.some((row) => row.prompt.toLowerCase() === prompt.toLowerCase()))
    : [];

  return (
    <Card className="space-y-4">
      <div className="flex items-start gap-3">
        <Trophy className="mt-0.5 h-5 w-5 shrink-0 text-volt" aria-hidden="true" />
        <div>
          <h2 className="font-medium text-paper">Photo challenges</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Prompts guests see as cards in the gallery. Each one they take gets a tick, and tapping a card shows
            everyone&apos;s photos for it.
          </p>
        </div>
      </div>

      {rows === null ? (
        !message && <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          {rows.length > 0 && (
            <ol className="space-y-2">
              {rows.map((row, index) => (
                <li key={row.key} className="flex items-center gap-1.5">
                  <input
                    value={row.prompt}
                    aria-label={`Challenge ${index + 1}`}
                    maxLength={MAX_PROMPT_LENGTH}
                    onChange={(event) =>
                      change(rows.map((other) => (other.key === row.key ? { ...other, prompt: event.target.value } : other)))
                    }
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move "${row.prompt}" up`}
                    className="flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:text-paper disabled:opacity-30"
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === rows.length - 1}
                    aria-label={`Move "${row.prompt}" down`}
                    className="flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:text-paper disabled:opacity-30"
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => change(rows.filter((other) => other.key !== row.key))}
                    aria-label={`Remove "${row.prompt}"`}
                    className="flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:text-paper"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
          )}

          {rows.length < MAX_CHALLENGES && (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                add(draft);
                setDraft("");
              }}
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={MAX_PROMPT_LENGTH}
                placeholder="The worst dance move"
                aria-label="New challenge"
                className={inputClass}
              />
              <Button type="submit" variant="ghost" disabled={!draft.trim()} className="shrink-0 gap-1.5">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add
              </Button>
            </form>
          )}

          {rows.length < MAX_CHALLENGES && suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {suggestions.slice(0, rows.length === 0 ? 6 : 3).map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => add(prompt)}
                  className="min-h-9 rounded-full border border-canvas-line px-3 text-xs text-muted transition-colors hover:border-volt/50 hover:text-paper"
                >
                  + {prompt}
                </button>
              ))}
            </div>
          )}

          <Checkbox
            checked={leaderboard}
            onChange={(event) => {
              setLeaderboard(event.target.checked);
              setDirty(true);
              setMessage(null);
            }}
            hint="The five guests who have shared the most, by the name they gave when they joined. Guests who gave no name are never listed."
          >
            Show a leaderboard in the gallery
          </Checkbox>

          <Button onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save challenges"}
          </Button>
        </>
      )}

      {message && (
        <p className="text-sm text-muted" role="status">
          {message}
        </p>
      )}
    </Card>
  );
}
