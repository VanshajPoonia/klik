"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiRequest } from "@/lib/api-client";
import type { ManagedShare } from "@/lib/share-access";

export interface CreateShareFields {
  mediaId: string;
  allowDownload: boolean;
  expiresInDays: number | null;
  maxViews: number | null;
  password: string | null;
}

/**
 * The organizer's view of an event's share links, and the three things they do
 * to them.
 *
 * Shared by the per-photo sheet and the event-wide Links tab. Both need the same
 * load, create, revoke and edit, and the alternative was two copies of the same
 * bookkeeping, one of which would eventually get a rollback subtly wrong.
 *
 * Nothing here is optimistic, deliberately, and this is the one corner of the
 * dashboard where that is the right call. Elsewhere a failed optimistic update
 * is a wrong label for a second. Here a link shown as turned off while the
 * server still has it live is a photo the host believes is unreachable and is
 * not, so every mutation waits for the server and stores exactly what came back.
 */
export function useShareLinks(eventId: string, mediaId?: string) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());

  const listUrl = mediaId
    ? `/api/events/${eventId}/shares?mediaId=${encodeURIComponent(mediaId)}`
    : `/api/events/${eventId}/shares`;

  // SWR rather than a hand-rolled fetch effect, as the guest gallery does. It
  // also means a mutation can write straight into the cache instead of keeping
  // a second copy of the list in local state.
  const { data, error: loadError, isLoading, mutate } = useSWR<ManagedShare[]>(
    listUrl,
    async (url: string) => {
      const result = await apiRequest<{ shares: ManagedShare[] }>(url);
      if (!result.ok) throw new Error(result.error);
      return result.data.shares;
    },
    { revalidateOnFocus: false },
  );

  const shares = data ?? [];

  function setBusy(shareId: string, busy: boolean) {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(shareId);
      else next.delete(shareId);
      return next;
    });
  }

  /** `revalidate: false` because the response already is the server's answer;
   *  refetching would only add a round trip and a chance to flicker. */
  function replace(updated: ManagedShare) {
    void mutate(
      (current = []) => current.map((share) => (share.id === updated.id ? updated : share)),
      { revalidate: false },
    );
  }

  /** Returns the new link, so the caller can hand it straight to the share sheet. */
  async function create(fields: CreateShareFields): Promise<ManagedShare | null> {
    setActionError(null);
    const result = await apiRequest<{ share: ManagedShare }>(
      `/api/events/${eventId}/shares`,
      { method: "POST", body: fields },
      "Could not create the link.",
    );
    if (!result.ok) {
      setActionError(result.error);
      return null;
    }
    await mutate((current = []) => [result.data.share, ...current], { revalidate: false });
    return result.data.share;
  }

  async function revoke(shareId: string) {
    setActionError(null);
    setBusy(shareId, true);
    const result = await apiRequest<{ share: ManagedShare }>(
      `/api/events/${eventId}/shares/${shareId}`,
      { method: "DELETE" },
      "Could not turn the link off.",
    );
    setBusy(shareId, false);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    replace(result.data.share);
  }

  async function update(
    shareId: string,
    changes: {
      allowDownload?: boolean;
      expiresInDays?: number | null;
      maxViews?: number | null;
      password?: string | null;
    },
  ) {
    setActionError(null);
    setBusy(shareId, true);
    const result = await apiRequest<{ share: ManagedShare }>(
      `/api/events/${eventId}/shares/${shareId}`,
      { method: "PATCH", body: changes },
      "Could not change the link.",
    );
    setBusy(shareId, false);

    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    replace(result.data.share);
  }

  return {
    shares,
    loading: isLoading,
    // A failed action is the more recent news, so it wins over a stale load
    // failure rather than being appended to it.
    error: actionError ?? (loadError instanceof Error ? loadError.message : null),
    busyIds,
    create,
    revoke,
    update,
  };
}
