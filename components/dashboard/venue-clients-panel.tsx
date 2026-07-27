"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import type { VenueClient } from "@/lib/schema";

type ClientDraft = { name: string; email: string; phone: string };

const emptyDraft: ClientDraft = { name: "", email: "", phone: "" };

export function VenueClientsPanel({ initialClients }: { initialClients: VenueClient[] }) {
  const router = useRouter();
  const [clients, setClients] = useState(initialClients);
  const [draft, setDraft] = useState<ClientDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function beginEdit(client: VenueClient) {
    setEditingId(client.id);
    setDraft({
      name: client.name,
      email: client.email ?? "",
      phone: client.phone ?? "",
    });
    setError(null);
  }

  function resetForm() {
    setEditingId(null);
    setDraft(emptyDraft);
    setError(null);
  }

  async function saveClient(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch(
      editingId ? `/api/venue/clients/${editingId}` : "/api/venue/clients",
      {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      },
    );
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "Could not save this client");
      return;
    }
    setClients((current) =>
      editingId
        ? current.map((client) => (client.id === editingId ? data.client : client))
        : [...current, data.client].sort((a, b) => a.name.localeCompare(b.name)),
    );
    resetForm();
    router.refresh();
  }

  async function deleteClient(client: VenueClient) {
    if (!window.confirm(`Delete ${client.name} from the client directory?`)) return;
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/venue/clients/${client.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "Could not delete this client");
      return;
    }
    setClients((current) => current.filter((candidate) => candidate.id !== client.id));
    if (editingId === client.id) resetForm();
    router.refresh();
  }

  return (
    <Card className="mb-10 space-y-5">
      <div>
        <p className="text-xs font-medium tracking-wide text-volt uppercase">Venue tools</p>
        <h2 className="mt-1 font-display text-xl text-paper">Client directory</h2>
        <p className="mt-1 text-sm text-muted">
          Save contacts once, then link them to new and existing events.
        </p>
      </div>

      <form onSubmit={saveClient} className="grid gap-3 md:grid-cols-3">
        <Field label="Client name">
          <input
            className={inputClass}
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            maxLength={120}
            required
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            className={inputClass}
            value={draft.email}
            onChange={(event) =>
              setDraft((current) => ({ ...current, email: event.target.value }))
            }
            maxLength={254}
          />
        </Field>
        <Field label="Phone">
          <input
            type="tel"
            className={inputClass}
            value={draft.phone}
            onChange={(event) =>
              setDraft((current) => ({ ...current, phone: event.target.value }))
            }
            maxLength={40}
          />
        </Field>
        <div className="flex gap-2 md:col-span-3">
          <Button type="submit" disabled={busy || !draft.name.trim()}>
            {editingId ? (
              <Pencil className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
            {editingId ? "Save client" : "Add client"}
          </Button>
          {editingId && (
            <Button type="button" variant="ghost" onClick={resetForm}>
              <X className="h-4 w-4" aria-hidden="true" />
              Cancel
            </Button>
          )}
        </div>
      </form>

      {clients.length > 0 && (
        <div className="divide-y divide-canvas-line rounded-xl border border-canvas-line">
          {clients.map((client) => (
            <div
              key={client.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-paper">{client.name}</p>
                <p className="truncate text-xs text-muted">
                  {[client.email, client.phone].filter(Boolean).join(" · ") || "No contact details"}
                </p>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => beginEdit(client)}
                  className="rounded-lg p-2 text-muted hover:bg-paper/5 hover:text-paper"
                  aria-label={`Edit ${client.name}`}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => void deleteClient(client)}
                  className="rounded-lg p-2 text-muted hover:bg-red-500/10 hover:text-red-300"
                  aria-label={`Delete ${client.name}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </Card>
  );
}
