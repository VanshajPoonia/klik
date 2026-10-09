"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Tablet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, inputClass, selectClass } from "@/components/ui/field";
import { flattenFolders, type FolderNode } from "@/lib/folder-tree";
import { timeAgo } from "@/lib/time-ago";

interface KioskRow {
  id: string;
  name: string;
  albumId: string | null;
  createdAt: string;
  pairedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  pairingOpen: boolean;
  photos: number;
}

/**
 * VEN-2: the event's kiosks. Make one, pair a tablet with its one-time link,
 * see what it has taken, and switch it off. The tablet never signs in as the
 * host, so a kiosk can be left at a venue without leaving an account there.
 */
export function KioskPanel({ eventId, folders }: { eventId: string; folders: FolderNode[] }) {
  const [kiosks, setKiosks] = useState<KioskRow[] | null>(null);
  const [name, setName] = useState("Entrance kiosk");
  const [albumId, setAlbumId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ kioskId: string; url: string; qr: string } | null>(null);
  const [confirmOff, setConfirmOff] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/kiosks`);
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setKiosks(body.kiosks ?? []);
      setNow(Date.now());
    } else {
      setError(body.error ?? "Kiosks could not be loaded.");
    }
  }, [eventId]);

  useEffect(() => {
    // Fetched, not passed down, so "last seen" is fresh whenever the tab opens.
    let cancelled = false;
    fetch(`/api/events/${eventId}/kiosks`)
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (ok) setKiosks(body.kiosks ?? []);
        else setError(body.error ?? "Kiosks could not be loaded.");
      })
      .catch(() => !cancelled && setError("Kiosks could not be loaded."));
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  async function showPairing(kioskId: string, url: string) {
    const QRCode = (await import("qrcode")).default;
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: "M" });
    setPairing({ kioskId, url, qr });
    setCopied(false);
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/kiosks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, albumId: albumId || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "The kiosk could not be made.");
      await showPairing(body.kiosk.id, body.pairUrl);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The kiosk could not be made.");
    } finally {
      setBusy(null);
    }
  }

  async function repair(kioskId: string) {
    setBusy(kioskId);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/kiosks/${kioskId}/pair`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "A new link could not be made.");
      await showPairing(kioskId, body.pairUrl);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "A new link could not be made.");
    } finally {
      setBusy(null);
    }
  }

  async function switchOff(kioskId: string) {
    setBusy(kioskId);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/kiosks/${kioskId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "It could not be switched off.");
      }
      if (pairing?.kioskId === kioskId) setPairing(null);
      setConfirmOff(null);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "It could not be switched off.");
    } finally {
      setBusy(null);
    }
  }

  const folderName = (id: string | null) => folders.find((folder) => folder.id === id)?.name ?? null;
  const live = (kiosks ?? []).filter((kiosk) => !kiosk.revokedAt);
  const off = (kiosks ?? []).filter((kiosk) => kiosk.revokedAt);

  return (
    <Card className="max-w-md space-y-5">
      <div className="flex items-start gap-3">
        <Tablet className="mt-0.5 h-5 w-5 shrink-0 text-volt" aria-hidden="true" />
        <div>
          <h2 className="font-medium text-paper">Kiosks</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            A tablet at the door that only takes photos for the gallery. Guests tap it, smile, and it resets for the
            next person. It never signs in as you.
          </p>
        </div>
      </div>

      {pairing && (
        <div className="space-y-3 rounded-2xl border border-volt/40 bg-canvas p-4 text-center">
          <p className="text-sm font-medium text-paper">Open this on the tablet</p>
          <div className="mx-auto w-fit rounded-xl bg-paper p-2">
            <Image src={pairing.qr} alt="QR code that pairs a tablet as this kiosk" width={180} height={180} unoptimized />
          </div>
          <p className="text-xs leading-relaxed text-muted">
            Scan it with the tablet&apos;s camera, or type the link. It works once, for thirty minutes.
          </p>
          <div className="truncate rounded-xl border border-canvas-line px-3 py-2 text-xs text-muted">{pairing.url}</div>
          <div className="flex justify-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(pairing.url);
                  setCopied(true);
                } catch {
                  // The link is on screen to copy by hand.
                }
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPairing(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {kiosks === null && !error && <p className="text-sm text-muted">Loading…</p>}

      {live.length > 0 && (
        <ul className="divide-y divide-canvas-line rounded-2xl border border-canvas-line">
          {live.map((kiosk) => (
            <li key={kiosk.id} className="space-y-2 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium text-paper">{kiosk.name}</p>
                <p className="shrink-0 text-xs tabular-nums text-muted">
                  {kiosk.photos} {kiosk.photos === 1 ? "photo" : "photos"}
                </p>
              </div>
              <p className="text-xs text-muted">
                {kiosk.lastSeenAt
                  ? `Paired. Last seen ${timeAgo(kiosk.lastSeenAt, now)}.`
                  : kiosk.pairingOpen
                    ? "Waiting for a tablet to open its link."
                    : "Not paired. Make a new link to set up a tablet."}
                {folderName(kiosk.albumId) ? ` Photos go into ${folderName(kiosk.albumId)}.` : ""}
              </p>
              {confirmOff === kiosk.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs text-paper">Switch it off? Its tablet stops working at once.</p>
                  <Button size="sm" disabled={busy !== null} onClick={() => void switchOff(kiosk.id)}>
                    {busy === kiosk.id ? "Switching off…" : "Switch off"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmOff(null)}>
                    Keep it
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void repair(kiosk.id)}>
                    {busy === kiosk.id ? "Making…" : "New pairing link"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmOff(kiosk.id)}>
                    Switch off
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(event) => void create(event)} className="space-y-3">
        <Field label="New kiosk" htmlFor="kiosk-name">
          <input
            id="kiosk-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            required
            className={inputClass}
          />
        </Field>
        {folders.length > 0 && (
          <Field label="Its photos go into" htmlFor="kiosk-folder">
            <select id="kiosk-folder" value={albumId} onChange={(event) => setAlbumId(event.target.value)} className={selectClass}>
              <option value="">No folder</option>
              {flattenFolders(folders).map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {"   ".repeat(folder.depth - 1)}
                  {folder.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Button type="submit" disabled={busy !== null || !name.trim()}>
          {busy === "create" ? "Setting up…" : "Set up a kiosk"}
        </Button>
      </form>

      <p className="text-xs leading-relaxed text-muted">
        To keep guests on the kiosk screen, lock the tablet to it: Guided Access on an iPad (Settings, Accessibility),
        or screen pinning on Android. Keep it plugged in; the screen stays on.
      </p>

      {off.length > 0 && (
        <p className="text-xs text-muted">
          Switched off: {off.map((kiosk) => `${kiosk.name} (${kiosk.photos} ${kiosk.photos === 1 ? "photo" : "photos"})`).join(", ")}.
        </p>
      )}

      {error && (
        <p className="text-sm text-muted" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
