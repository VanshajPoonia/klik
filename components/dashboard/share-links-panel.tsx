"use client";

import { useState } from "react";
import Image from "next/image";
import { Folder } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ShareLinkRow } from "@/components/dashboard/share-link-row";
import { ShareSettingsEditor } from "@/components/dashboard/share-settings-editor";
import { useShareLinks } from "@/components/dashboard/use-share-links";
import { mediaContentPath, mediaPosterPath } from "@/lib/media-delivery";
import { shareState, type ManagedShare } from "@/lib/share-access";

/** What a link points at, in words, above its row. A photo needs none: its
 *  thumbnail is the answer. */
function targetLabel(share: ManagedShare): string | null {
  if (share.scope === "album") return share.albumName ? `Folder: ${share.albumName}` : "A folder now in the trash";
  if (share.scope === "selection") {
    const count = share.itemCount ?? 0;
    return count === 0 ? "A selection, now empty" : `${count} selected ${count === 1 ? "photo" : "photos"}`;
  }
  return null;
}

/**
 * Every share link on the event, in one place.
 *
 * The reason this screen exists is that links outlive the moment they were
 * created. A host makes a dozen over a weekend from a dozen different photos and
 * has no memory of which ones are still open, so the per-photo sheet alone
 * cannot answer "what have I got out there". This can.
 *
 * Each row carries the photo it points at, because a token is not recognisable
 * and the question an organizer arrives with is about a picture, not a URL.
 */
export function ShareLinksPanel({ eventId, slug }: { eventId: string; slug: string }) {
  const { shares, loading, error, busyIds, revoke, update } = useShareLinks(eventId);
  const [showAll, setShowAll] = useState(false);

  const live = shares.filter((share) => shareState(share) === "live");
  const closed = shares.length - live.length;
  const visible = showAll ? shares : live;

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h2 className="font-display text-xl text-paper">Share links</h2>
        <p className="mt-1.5 text-sm text-muted">
          Every link you have made to a photo, a folder or a selection in this
          gallery. Anyone holding a live link can open what it points at without
          joining the gallery.
        </p>
      </div>

      {error && (
        <p
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
          role="alert"
        >
          {error}
        </p>
      )}

      {closed > 0 && (
        <div className="flex gap-1" role="group" aria-label="Which links to show">
          {[
            { key: false, label: `Live (${live.length})` },
            { key: true, label: `All (${shares.length})` },
          ].map((option) => (
            <button
              key={String(option.key)}
              type="button"
              onClick={() => setShowAll(option.key)}
              aria-pressed={showAll === option.key}
              className={`min-h-11 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
                showAll === option.key
                  ? "border-volt text-volt"
                  : "border-canvas-line text-muted hover:text-paper"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading links</p>
      ) : visible.length === 0 ? (
        <Card className="text-sm text-muted">
          {shares.length === 0
            ? "No share links yet. Open a photo or a folder in the gallery and use Share, or select photos and make one link for them all."
            : "No live links. Switch to All to see the ones you turned off."}
        </Card>
      ) : (
        <div className="space-y-2.5">
          {visible.map((share) => {
            const previewId = share.mediaId ?? share.previewMediaId;
            const previewKind = share.mediaId ? share.mediaKind : share.previewKind;
            const label = targetLabel(share);
            return (
              <div key={share.id} className="flex gap-3">
                {previewId ? (
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-canvas-line bg-canvas">
                    <Image
                      src={
                        previewKind === "video"
                          ? mediaPosterPath(slug, previewId)
                          : `${mediaContentPath(slug, previewId)}?thumb=1`
                      }
                      alt=""
                      fill
                      unoptimized
                      sizes="64px"
                      className="object-cover"
                    />
                    {share.scope === "selection" && (share.itemCount ?? 0) > 1 && (
                      <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] font-medium tabular-nums text-paper">
                        {share.itemCount}
                      </span>
                    )}
                  </div>
                ) : share.scope === "album" ? (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-canvas-line bg-canvas text-muted">
                    <Folder className="h-6 w-6" aria-hidden="true" />
                  </div>
                ) : null}
                <div className="min-w-0 flex-1">
                  {label && <p className="mb-1.5 truncate text-sm font-medium text-paper">{label}</p>}
                  <ShareLinkRow
                    share={share}
                    busy={busyIds.has(share.id)}
                    onRevoke={(id) => void revoke(id)}
                  >
                    <ShareSettingsEditor
                      share={share}
                      busy={busyIds.has(share.id)}
                      onSave={(changes) => void update(share.id, changes)}
                    />
                  </ShareLinkRow>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
