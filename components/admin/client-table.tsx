"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { inputClass } from "@/components/ui/field";
import type { ClientSummary } from "@/lib/admin-clients";

const FILTERS = [
  { key: "customers", label: "Customers" },
  { key: "waiting", label: "Needs a decision" },
  { key: "live", label: "Live" },
  { key: "guests", label: "Guests" },
  { key: "all", label: "All" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

function matches(client: ClientSummary, filter: Filter) {
  switch (filter) {
    case "customers":
      return client.kind !== "guest";
    case "waiting":
      return client.requested > 0 || (client.kind === "customer" && !client.activated);
    case "live":
      return client.live > 0;
    case "guests":
      return client.kind === "guest";
    default:
      return true;
  }
}

/**
 * Every account, one line each, found by typing any part of a name, email or
 * handle. The line says what they are on and what their events are doing;
 * everything you can do to an account is on its own page, one click away.
 */
export function ClientTable({ clients }: { clients: ClientSummary[] }) {
  const [filter, setFilter] = useState<Filter>("customers");
  const [query, setQuery] = useState("");

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((option) => [option.key, clients.filter((client) => matches(client, option.key)).length])),
    [clients],
  );
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/^@/, "");
    return clients.filter(
      (client) =>
        matches(client, needle ? "all" : filter) &&
        (!needle ||
          [client.name, client.email, client.username].some((value) => value?.toLowerCase().includes(needle))),
    );
  }, [clients, filter, query]);

  return (
    <div className="space-y-4">
      <input
        type="search"
        className={inputClass}
        placeholder="Find by name, email or @handle"
        aria-label="Find a client"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {!query.trim() && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option.key)}
              aria-pressed={filter === option.key}
              className="min-h-9 rounded-full border border-canvas-line px-3.5 text-sm text-muted transition-colors hover:text-paper aria-pressed:border-transparent aria-pressed:bg-paper aria-pressed:text-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
            >
              {option.label} <span className="tabular-nums opacity-70">{counts[option.key]}</span>
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-canvas-line px-4 py-6 text-center text-sm text-muted">
          {query.trim() ? "Nobody matches that." : "Nobody here."}
        </p>
      ) : (
        <ul className="divide-y divide-canvas-line rounded-xl border border-canvas-line">
          {shown.map((client) => (
            <li key={client.userId}>
              <Link
                href={`/admin/clients/${client.userId}`}
                className="flex min-h-16 flex-col gap-2 px-4 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-paper/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-volt sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-paper">
                    {client.name || (client.username ? `@${client.username}` : client.email) || "Unnamed account"}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {[client.email, client.username ? `@${client.username}` : null].filter(Boolean).join(" · ")}
                    {` · joined ${client.joined}`}
                  </p>
                  {client.asked && !client.activated && (
                    <p className="truncate text-xs text-muted">Asked for {client.asked}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {client.kind === "admin" && <Badge tone="neutral">Klik</Badge>}
                  {client.kind === "guest" && <Badge tone="neutral">guest</Badge>}
                  {client.kind === "customer" && !client.activated && <Badge tone="warning">not activated</Badge>}
                  {client.requested > 0 && <Badge tone="danger">asked to go live</Badge>}
                  <span className="text-xs text-muted">{client.plan}</span>
                  {client.live > 0 && <Badge tone="volt">{client.live} live</Badge>}
                  {client.drafts > 0 && <Badge tone="warning">{client.drafts} draft{client.drafts === 1 ? "" : "s"}</Badge>}
                  {client.lapsed > 0 && <Badge tone="danger">{client.lapsed} lapsed</Badge>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
