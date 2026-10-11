"use client";

import { useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { LABEL_NAMES } from "@/lib/vision";
import type { SearchSelection } from "@/components/media/gallery-search";

/**
 * AI-4 on the dashboard: save the open search or scene as a smart folder, or
 * rename or delete the smart folder that is open. Shown beside the result
 * count, so it is where the host is already looking.
 */
export function SmartFolderActions({
  eventId,
  selection,
  onSaved,
  onRenamed,
  onDeleted,
}: {
  eventId: string;
  selection: SearchSelection;
  onSaved: () => void;
  onRenamed: (name: string) => void;
  onDeleted: () => void;
}) {
  const suggested =
    selection.kind === "text"
      ? selection.q.charAt(0).toUpperCase() + selection.q.slice(1)
      : selection.kind === "scene"
        ? LABEL_NAMES.en[selection.label]
        : selection.name;
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(suggested);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError(null);
    const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      const body = await response?.json().catch(() => ({}));
      setError((body as { error?: string } | undefined)?.error ?? "That did not work");
      return false;
    }
    return true;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (selection.kind === "folder") {
      if (await send(`/api/events/${eventId}/smart-folders/${selection.id}`, { method: "PATCH", body: JSON.stringify({ name: trimmed }) })) {
        setNaming(false);
        onRenamed(trimmed);
      }
      return;
    }
    const query = selection.kind === "text" ? { type: "search", text: selection.q } : { type: "scene", label: selection.label };
    if (await send(`/api/events/${eventId}/smart-folders`, { method: "POST", body: JSON.stringify({ name: trimmed, query }) })) {
      setNaming(false);
      onSaved();
    }
  }

  async function remove() {
    if (selection.kind !== "folder") return;
    if (await send(`/api/events/${eventId}/smart-folders/${selection.id}`, { method: "DELETE" })) onDeleted();
  }

  const link =
    "min-h-11 rounded-full px-3 text-sm text-paper underline-offset-2 hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt";

  if (naming) {
    return (
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <label htmlFor="smart-folder-name" className="sr-only">
          Folder name
        </label>
        <input
          id="smart-folder-name"
          value={name}
          maxLength={60}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          className="h-11 w-48 rounded-full border border-canvas-line bg-canvas-raised px-4 text-sm text-paper focus-visible:border-volt focus-visible:outline-none"
        />
        <button type="submit" disabled={busy || !name.trim()} className={link}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setNaming(false)} className={link}>
          Cancel
        </button>
        {error && (
          <span className="text-xs text-red-400" role="alert">
            {error}
          </span>
        )}
      </form>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1">
      {selection.kind === "folder" ? (
        <>
          <button type="button" onClick={() => setNaming(true)} className={link}>
            Rename
          </button>
          <button type="button" disabled={busy} onClick={() => void remove()} className={link}>
            {busy ? "Deleting…" : "Delete folder"}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setNaming(true)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-canvas-line px-4 text-sm text-paper transition-colors hover:border-volt/50 hover:text-volt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Save as smart folder
        </button>
      )}
      {error && (
        <span className="text-xs text-red-400" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
