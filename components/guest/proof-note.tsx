"use client";

import { useEffect, useState } from "react";
import { Stamp } from "lucide-react";
import { useGuestCopy } from "@/components/guest/guest-copy";

type Note = { by: string; note: string | null; url: string | null };

// One answer per photo for the life of the page: the photographer's words do
// not change while someone is flicking through their proofs.
const notes = new Map<string, Promise<Note | null>>();

function loadNote(slug: string, mediaId: string): Promise<Note | null> {
  const key = `${slug}/${mediaId}`;
  let pending = notes.get(key);
  if (!pending) {
    pending = fetch(`/api/e/${encodeURIComponent(slug)}/media/${encodeURIComponent(mediaId)}/proof`)
      .then((response) => (response.ok ? (response.json() as Promise<Note>) : null))
      .catch(() => null);
    notes.set(key, pending);
  }
  return pending;
}

/**
 * MED-10: under a watermarked proof, whose it is and how to get the clean
 * photo, in the photographer's own words. Klik takes no part in the sale.
 */
export function ProofNote({ slug, mediaId }: { slug: string; mediaId: string }) {
  const { t } = useGuestCopy();
  const [note, setNote] = useState<{ id: string; value: Note | null } | null>(null);

  useEffect(() => {
    let live = true;
    void loadNote(slug, mediaId).then((value) => {
      if (live) setNote({ id: mediaId, value });
    });
    return () => {
      live = false;
    };
  }, [slug, mediaId]);

  const value = note?.id === mediaId ? note.value : null;
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-center">
      <div className="pointer-events-auto flex max-w-md items-start gap-2 rounded-2xl bg-black/75 px-3 py-2 text-xs text-paper backdrop-blur">
        <Stamp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-volt" aria-hidden="true" />
        <div className="min-w-0">
          <p>{t.proof.note(value?.by ?? null)}</p>
          {value?.note && <p className="mt-1 text-paper/80">{value.note}</p>}
          {value?.url && (
            <a
              href={value.url}
              target={value.url.startsWith("mailto:") ? undefined : "_blank"}
              rel="noopener noreferrer nofollow"
              className="mt-1.5 inline-flex min-h-8 items-center font-medium text-volt underline-offset-2 hover:underline"
            >
              {t.proof.ask}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
