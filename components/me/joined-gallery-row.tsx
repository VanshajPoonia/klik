"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";
import type { JoinedGallery } from "@/lib/guest-accounts";

export function JoinedGalleryRow({ gallery }: { gallery: JoinedGallery }) {
  const [state, setState] = useState<"idle" | "confirm" | "working" | "gone">("idle");
  const [uploads, setUploads] = useState(gallery.uploads);
  const [error, setError] = useState<string | null>(null);

  async function forget() {
    setState("working");
    setError(null);
    const result = await apiRequest(
      `/api/me/galleries/${gallery.eventId}`,
      { method: "DELETE" },
      "Could not remove them",
    );
    if (!result.ok) {
      setError(result.error);
      setState("confirm");
      return;
    }
    setUploads(0);
    setState("gone");
  }

  if (state === "gone") {
    return (
      <Card className="text-sm text-muted">
        Everything you added to {gallery.name} has been removed, and the gallery is off your account.
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <a href={`/e/${gallery.slug}`} className="block truncate font-medium text-paper hover:text-volt">
            {gallery.name}
          </a>
          <p className="mt-0.5 text-xs text-muted">
            {uploads === 0 ? "You have not added anything" : uploads === 1 ? "You added 1 photo or video" : `You added ${uploads} photos and videos`}
            {gallery.ended && " · event ended"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a href={`/e/${gallery.slug}`} className="text-sm text-volt hover:underline">
            Open
          </a>
          {/* TRS-2: what this account shared there, as a ZIP with a data.json. */}
          {uploads > 0 && (
            <a href={`/api/e/${gallery.slug}/me/export`} download className="text-sm text-muted hover:text-paper hover:underline">
              Download mine
            </a>
          )}
          {state === "idle" && (
            <Button variant="ghost" size="sm" onClick={() => setState("confirm")}>
              Remove mine
            </Button>
          )}
        </div>
      </div>
      {(state === "confirm" || state === "working") && (
        <div className="mt-3 rounded-xl border border-canvas-line p-3">
          <p className="text-sm text-paper">
            Remove every photo and video you added to {gallery.name}, and your name? This is permanent,
            and the host cannot restore them.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="danger" size="sm" onClick={() => void forget()} disabled={state === "working"}>
              {state === "working" ? "Removing…" : "Remove everything"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setState("idle")} disabled={state === "working"}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p className="mt-2 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
