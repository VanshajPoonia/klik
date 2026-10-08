"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    const result = await apiRequest<{ eventId: string }>(
      `/api/invites/${encodeURIComponent(token)}`,
      { method: "POST" },
      "Could not accept this invitation",
    );
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    router.replace(`/dashboard/events/${result.data.eventId}`);
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm space-y-3">
      <Button className="w-full" onClick={() => void accept()} disabled={busy}>
        {busy ? "Joining…" : "Join the team"}
      </Button>
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
