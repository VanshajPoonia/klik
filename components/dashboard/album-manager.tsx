"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { apiRequest } from "@/lib/api-client";

export function AlbumManager({
  eventId,
  initialAlbums,
  onDeleted,
}: {
  eventId: string;
  initialAlbums: Array<{ id: string; name: string }>;
  onDeleted?: (albumId: string) => void;
}) {
  const router = useRouter();
  const [albums, setAlbums] = useState(initialAlbums);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createAlbum(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await apiRequest<{ album: { id: string; name: string } }>(
      `/api/events/${eventId}/albums`,
      { method: "POST", body: { name } },
      "Could not create the album",
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAlbums((current) => [...current, result.data.album]);
    setName("");
    router.refresh();
  }

  async function deleteAlbum(albumId: string) {
    if (!window.confirm("Delete this album? Its media will stay in the main gallery.")) return;
    setBusy(true);
    setError(null);
    const result = await apiRequest(
      `/api/events/${eventId}/albums/${albumId}`,
      { method: "DELETE" },
      "Could not delete the album",
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAlbums((current) => current.filter((album) => album.id !== albumId));
    onDeleted?.(albumId);
    router.refresh();
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-medium text-paper">Albums</h2>
        <p className="mt-1 text-xs text-muted">
          Organize one event into separate moments or groups.
        </p>
      </div>
      <form onSubmit={createAlbum} className="flex flex-col gap-2 sm:flex-row">
        <input
          className={inputClass}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ceremony"
          maxLength={60}
          required
        />
        <Button type="submit" disabled={busy || !name.trim()} className="shrink-0">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add album
        </Button>
      </form>
      {albums.length > 0 && (
        <ul className="divide-y divide-canvas-line rounded-xl border border-canvas-line">
          {albums.map((album) => (
            <li key={album.id} className="flex min-h-12 items-center justify-between gap-3 pl-3 pr-1">
              <span className="text-sm text-paper">{album.name}</span>
              <IconButton
                tone="danger"
                label={`Delete ${album.name} album`}
                onClick={() => void deleteAlbum(album.id)}
                disabled={busy}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
