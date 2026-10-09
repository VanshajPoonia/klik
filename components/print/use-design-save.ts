"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PrintDoc } from "@/lib/print/doc";

/**
 * QR-4a: autosave. Every change is saved a moment after the host stops, with
 * the revision it was made from; a save from a copy someone else has moved
 * past (a second tab, a co-host) comes back as a conflict, and the host
 * chooses which to keep rather than one silently erasing the other.
 */

export type SaveStatus = "saved" | "pending" | "saving" | "error" | "conflict";

export interface Conflict {
  revision: number;
  doc: PrintDoc;
  updatedAt: string;
}

const DEBOUNCE_MS = 1200;
const RETRY_MS = 6000;

export function useDesignSave({
  eventId,
  designId,
  initialRevision,
  doc,
  version,
  name,
  onSaved,
}: {
  eventId: string;
  designId: string;
  initialRevision: number;
  doc: PrintDoc;
  /** Moves on every edit; equal to the last saved one means nothing to save. */
  version: number;
  name: string;
  onSaved?: () => void;
}) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [savedName, setSavedName] = useState(name);
  const revision = useRef(initialRevision);
  const savedVersion = useRef(version);
  const latest = useRef({ doc, version, name });
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSavedRef = useRef(onSaved);
  // A retry calls the latest `save`, which is only known after it is made.
  const saveRef = useRef<(force?: boolean) => Promise<void>>(async () => {});
  const url = `/api/events/${eventId}/designs/${designId}`;

  useEffect(() => {
    latest.current = { doc, version, name };
    onSavedRef.current = onSaved;
  });

  const save = useCallback(
    async (force = false) => {
      if (inFlight.current) return;
      const sending = latest.current;
      if (!force && sending.version === savedVersion.current && sending.name === savedName) {
        setStatus("saved");
        return;
      }
      inFlight.current = true;
      setStatus("saving");
      try {
        const response = await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ doc: sending.doc, name: sending.name, baseRevision: revision.current, force }),
        });
        const body = await response.json().catch(() => ({}));
        if (response.status === 409 && body.current) {
          setConflict({ revision: body.current.revision, doc: body.current.doc, updatedAt: body.current.updatedAt });
          setStatus("conflict");
          return;
        }
        if (!response.ok) throw new Error(body.error ?? "save failed");
        revision.current = body.design.revision;
        savedVersion.current = sending.version;
        setSavedName(sending.name);
        setConflict(null);
        onSavedRef.current?.();
        const moved = latest.current.version !== sending.version || latest.current.name !== sending.name;
        setStatus(moved ? "pending" : "saved");
        if (moved) timer.current = setTimeout(() => void saveRef.current(), DEBOUNCE_MS);
      } catch {
        setStatus("error");
        timer.current = setTimeout(() => void saveRef.current(), RETRY_MS);
      } finally {
        inFlight.current = false;
      }
    },
    [savedName, url],
  );

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // A change, or a new name, saves a moment after the last one.
  useEffect(() => {
    if (status === "conflict") return;
    if (version === savedVersion.current && name === savedName) return;
    setStatus((current) => (current === "saving" ? current : "pending"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [version, name, savedName, save, status]);

  // Leaving with unsaved work asks first, and tries one last save on the way out.
  useEffect(() => {
    const unsaved = () => latest.current.version !== savedVersion.current;
    const warn = (event: BeforeUnloadEvent) => {
      if (!unsaved()) return;
      event.preventDefault();
    };
    const flush = () => {
      if (!unsaved()) return;
      const body = JSON.stringify({ doc: latest.current.doc, name: latest.current.name, baseRevision: revision.current });
      // Keepalive bodies are capped at 64 KB; a larger design relies on the prompt.
      if (body.length < 60_000) {
        void fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
      }
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("pagehide", flush);
    };
  }, [url]);

  return {
    status,
    conflict,
    /** Overwrite the other copy with this one. */
    keepMine: () => {
      setConflict(null);
      void save(true);
    },
    /** Take the other copy: the caller resets its design to `conflict.doc`. */
    takeTheirs: (taken: Conflict) => {
      revision.current = taken.revision;
      savedVersion.current = latest.current.version;
      setConflict(null);
      setStatus("saved");
    },
    /** After a version is restored on the server, which is a save of its own. */
    adopt: (next: { revision: number }) => {
      revision.current = next.revision;
      savedVersion.current = latest.current.version;
      setStatus("saved");
    },
  };
}
