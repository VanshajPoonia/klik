"use client";

import { useEffect, useRef, useState } from "react";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { ArrowLeft, Check, Download, Link2, Send, Smartphone, Share2 } from "lucide-react";
import { saveBlob } from "@/lib/enhance-view";
import {
  canShareFiles,
  composeMediaStory,
  fetchMediaBlob,
  photoLink,
  shareFilename,
  smallerCopy,
} from "@/lib/media-share";

interface ShareableItem {
  id: string;
  kind: "photo" | "video";
  src?: string | null;
  blobUrl: string;
}

type Prepared = { blob: Blob; file: File };

const ROW =
  "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm text-paper transition-colors hover:bg-white/5 disabled:opacity-50";
const TILE =
  "flex min-h-24 flex-col items-start justify-between gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-left text-sm text-paper transition-transform active:scale-[0.98] disabled:opacity-50";

/**
 * CAM-3: everything a viewer can do with one photo or video, in a sheet over
 * the viewer. Send the file itself through the phone's share sheet, post it as
 * a story with the gallery's QR code, copy a link that opens it in the
 * gallery, or save it full size or smaller. The organizer also gets MED-2's
 * share link, which works without joining.
 *
 * The share sheet has to open from a tap, and Safari forgets the tap if the
 * page waits on the network first. So a photo is fetched as soon as this
 * opens, and "Send" only calls the share sheet once the file is in hand. A
 * video can be hundreds of megabytes, so it waits to be asked.
 */
export function MediaSharePanel({
  item,
  slug,
  eventName,
  accent,
  canTakeFile,
  linkable,
  downloadHref,
  enhanced,
  onShareLink,
  onClose,
}: {
  item: ShareableItem;
  slug: string;
  eventName: string;
  accent: string;
  /** Send, save and make a story of it. Off when the host turned downloads off, except for the viewer's own. */
  canTakeFile: boolean;
  /** Others in the gallery can see it, so a link to it is worth sending. */
  linkable: boolean;
  /** The download route, which names the file and checks access again. */
  downloadHref: string | null;
  /** What the viewer is looking at, when the viewer enhanced it. */
  enhanced: Blob | null;
  /** MED-2, for the event's team: a link that works without joining. */
  onShareLink?: () => void;
  onClose: () => void;
}) {
  const noun = item.kind;
  const [fileSharing] = useState(() => canShareFiles());
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const [story, setStory] = useState<{ url: string; file: File } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const headingRef = useRef<HTMLParagraphElement>(null);

  // One fetch, however many buttons ask for the file while it is on its way.
  const pending = useRef<Promise<Prepared> | null>(null);
  const prepare = (): Promise<Prepared> => {
    if (pending.current) return pending.current;
    const abort = new AbortController();
    controller.current = abort;
    setProgress(0);
    pending.current = (async () => {
      const blob =
        enhanced ??
        (await fetchMediaBlob(item, { signal: abort.signal, onProgress: item.kind === "video" ? setProgress : undefined }));
      const type = blob.type || (item.kind === "photo" ? "image/jpeg" : "video/mp4");
      const ready = { blob, file: new File([blob], shareFilename(slug, item.id, type), { type }) };
      setPrepared(ready);
      return ready;
    })()
      .catch((error) => {
        pending.current = null;
        throw error;
      })
      .finally(() => setProgress(null));
    return pending.current;
  };

  // TRS-3: focus to the heading on open, and back to the Share button on close.
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef, { initial: headingRef, trap: false });

  // A photo is a megabyte or two: fetch it now so Send can open the share
  // sheet the instant it is tapped.
  useEffect(() => {
    if (canTakeFile && item.kind === "photo") {
      prepare().catch((error) => {
        if ((error as Error).name !== "AbortError") setMessage((error as Error).message);
      });
    }
    return () => controller.current?.abort();
    // Mounted once per item; the lightbox keys this panel by id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (story) URL.revokeObjectURL(story.url);
  }, [story]);

  async function share(file: File) {
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    if (!nav.canShare?.({ files: [file] })) {
      setMessage(`This browser cannot send a ${noun} this size. Save it instead.`);
      return;
    }
    try {
      await nav.share({ files: [file] });
    } catch (error) {
      const name = (error as Error).name;
      if (name === "NotAllowedError") setMessage("Tap Send again.");
      else if (name !== "AbortError") setMessage("That did not send. Try again, or save it instead.");
    }
  }

  async function run(label: string, task: () => Promise<void>) {
    setBusy(label);
    setMessage(null);
    try {
      await task();
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setMessage(error instanceof Error ? error.message : "That did not work. Try again.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    const link = photoLink(window.location.origin, slug, item.id);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused. Show the link to copy by hand.
      setManualLink(link);
    }
  }

  if (story) {
    return (
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Story image"
        className="absolute inset-x-3 bottom-3 z-10 mx-auto max-h-[calc(100%-1.5rem)] max-w-md space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-black/85 p-4 backdrop-blur"
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStory(null)}
            aria-label="Back"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper transition-transform active:scale-90"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <p className="text-sm font-medium text-paper">Your story, with the gallery&apos;s QR code</p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
        <img
          src={story.url}
          alt={`Story image of this photo from ${eventName}, with a QR code to the gallery`}
          className="mx-auto max-h-[45vh] w-auto rounded-xl"
        />
        <div className="flex flex-wrap gap-2">
          {fileSharing && (
            <button
              type="button"
              onClick={() => void share(story.file)}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-volt px-5 text-sm font-medium text-on-volt transition-transform active:scale-95"
            >
              <Share2 className="h-4 w-4" aria-hidden="true" />
              Share story
            </button>
          )}
          <button
            type="button"
            onClick={() => saveBlob(story.file, story.file.name)}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 px-5 text-sm text-paper transition-transform active:scale-95"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Save
          </button>
        </div>
        {message && (
          <p className="text-xs text-muted" role="status">
            {message}
          </p>
        )}
      </div>
    );
  }

  const sendReady = Boolean(prepared);
  const showSend = canTakeFile && fileSharing;
  const showStory = canTakeFile && item.kind === "photo";

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Share this ${noun}`}
      className="absolute inset-x-3 bottom-3 z-10 mx-auto max-h-[calc(100%-1.5rem)] max-w-md space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-black/85 p-4 backdrop-blur"
    >
      <p ref={headingRef} tabIndex={-1} className="text-sm font-medium text-paper outline-none">
        Share this {noun}
      </p>

      {(showSend || showStory) && (
        <div className={`grid gap-2 ${showSend && showStory ? "grid-cols-2" : "grid-cols-1"}`}>
          {showSend && (
            <button
              type="button"
              disabled={busy !== null || (item.kind === "photo" && !sendReady && !message)}
              onClick={() => {
                // Straight to the share sheet while the tap still counts.
                if (prepared) {
                  void share(prepared.file);
                  return;
                }
                void run("send", async () => {
                  await prepare();
                });
              }}
              className={TILE}
            >
              <Send className="h-5 w-5 text-volt" aria-hidden="true" />
              <span>
                <span className="block font-medium">
                  {progress !== null
                    ? item.kind === "video"
                      ? `Getting it ready… ${Math.round(progress * 100)}%`
                      : "Getting it ready…"
                    : item.kind === "video" && !sendReady
                      ? "Get video ready to send"
                      : `Send ${noun}`}
                </span>
                <span className="block text-xs text-muted">WhatsApp, Messages, anywhere</span>
              </span>
            </button>
          )}
          {showStory && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void run("story", async () => {
                  const { blob } = await prepare();
                  const composed = await composeMediaStory({
                    photo: blob,
                    eventName,
                    galleryUrl: `${window.location.origin}/e/${slug}`,
                    accent,
                  });
                  const file = new File([composed], shareFilename(slug, item.id, "image/jpeg", "-story"), { type: "image/jpeg" });
                  setStory({ url: URL.createObjectURL(composed), file });
                })
              }
              className={TILE}
            >
              <Smartphone className="h-5 w-5 text-volt" aria-hidden="true" />
              <span>
                <span className="block font-medium">{busy === "story" ? "Drawing…" : "Story with QR"}</span>
                <span className="block text-xs text-muted">Brings people to the gallery</span>
              </span>
            </button>
          )}
        </div>
      )}

      <div className="-mx-1">
        {onShareLink && (
          <button type="button" onClick={onShareLink} className={ROW}>
            <Share2 className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
            <span>
              <span className="block">Make a share link</span>
              <span className="block text-xs text-muted">Works without joining the gallery</span>
            </span>
          </button>
        )}
        {linkable && (
          <button type="button" onClick={() => void copyLink()} className={ROW}>
            {copied ? (
              <Check className="h-5 w-5 shrink-0 text-volt" aria-hidden="true" />
            ) : (
              <Link2 className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
            )}
            <span>
              <span className="block">{copied ? "Link copied" : "Copy link"}</span>
              <span className="block text-xs text-muted">Opens it for anyone who can open the gallery</span>
            </span>
          </button>
        )}
        {manualLink && (
          <input
            readOnly
            value={manualLink}
            aria-label="Link to this photo"
            onFocus={(focus) => focus.currentTarget.select()}
            className="mx-1 mb-2 w-[calc(100%-0.5rem)] rounded-xl border border-white/15 bg-transparent px-3 py-2 text-xs text-paper"
          />
        )}
        {canTakeFile && downloadHref && (
          <a
            href={downloadHref}
            onClick={(click) => {
              // Save what the viewer was looking at, when it was enhanced.
              if (!enhanced) return;
              click.preventDefault();
              saveBlob(enhanced, shareFilename(slug, item.id, enhanced.type || "image/jpeg"));
            }}
            className={ROW}
          >
            <Download className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
            <span>
              <span className="block">Save full size</span>
              <span className="block text-xs text-muted">
                {item.kind === "photo" ? "The best copy the gallery keeps" : "The video as it was uploaded"}
              </span>
            </span>
          </a>
        )}
        {canTakeFile && item.kind === "photo" && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run("smaller", async () => {
                const { blob } = await prepare();
                saveBlob(await smallerCopy(blob), shareFilename(slug, item.id, "image/jpeg", "-small"));
              })
            }
            className={ROW}
          >
            <Download className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
            <span>
              <span className="block">{busy === "smaller" ? "Making it…" : "Save a smaller copy"}</span>
              <span className="block text-xs text-muted">1600 pixels, for messages and the web</span>
            </span>
          </button>
        )}
      </div>

      {!canTakeFile && (
        <p className="text-xs leading-relaxed text-muted">The host has turned off saving photos from this gallery.</p>
      )}
      {message && (
        <p className="text-xs text-muted" role="status">
          {message}
        </p>
      )}
      <button
        type="button"
        onClick={onClose}
        className="min-h-11 w-full rounded-full border border-white/15 px-4 text-sm text-paper"
      >
        Done
      </button>
    </div>
  );
}
