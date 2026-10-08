"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";

/**
 * ORG-4: shown to the person an event has been offered to, on that event. The
 * decision is theirs alone, which is why it lives here and not with the owner.
 */
export function TransferOffer({ eventId, fromName }: { eventId: string; fromName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  async function respond(accept: boolean) {
    setBusy(true);
    setError(null);
    const result = await apiRequest(
      accept ? `/api/events/${eventId}/transfer/accept` : `/api/events/${eventId}/transfer`,
      { method: accept ? "POST" : "DELETE" },
      accept ? "Could not take over the event" : "Could not decline the offer",
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (accept) router.refresh();
    else setDeclined(true);
  }

  if (declined) return null;

  return (
    <div className="mb-6 rounded-2xl border border-volt/30 bg-volt/10 p-4 sm:p-5">
      <p className="font-medium text-paper">{fromName} has offered you this event</p>
      <p className="mt-1 max-w-xl text-sm text-muted">
        If you accept, it becomes yours to run, delete or hand on, and {fromName} stays on the team
        as a manager. The plan it runs on and every photo stay as they are.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void respond(true)} disabled={busy}>
          Take over the event
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void respond(false)} disabled={busy}>
          Decline
        </Button>
      </div>
      {error && (
        <p className="mt-3 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
