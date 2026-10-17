"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** ADM-7: bring an event back from the trash, from the all-events list. Uploads stay off until someone turns them on. */
export function RestoreEventButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  return (
    <button
      type="button"
      disabled={state === "working"}
      onClick={async () => {
        setState("working");
        const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/restore`, { method: "POST" }).catch(() => null);
        if (!response?.ok) {
          setState("failed");
          return;
        }
        router.refresh();
      }}
      className="rounded-full px-2.5 py-1 text-xs text-muted hover:bg-paper/5 hover:text-paper disabled:opacity-50"
    >
      {state === "working" ? "Restoring…" : state === "failed" ? "Could not restore" : "Restore"}
    </button>
  );
}
