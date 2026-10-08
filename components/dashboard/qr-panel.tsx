"use client";

import { useState } from "react";
import Image from "next/image";
import { Mail, MessageCircle, Send, Share2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button, buttonClassName } from "@/components/ui/button";
import { composeSign, composeStory, shareOrDownload } from "@/lib/qr-compose";

type QrStyle = "classic" | "dots" | "rounded";

const STYLE_LABELS: Record<QrStyle, string> = { classic: "Classic", dots: "Dots", rounded: "Rounded" };

/**
 * The event's QR code and every way to get it in front of guests (QR-2, QR-3):
 * a style on Premium, a share sheet that sends the image itself to WhatsApp,
 * prefilled messages, a printable sign and a story image. A styled code is
 * decoded on the server before it is served, so the preview here is always one
 * a phone can read.
 */
export function QrPanel({
  eventId,
  slug,
  guestUrl,
  eventName,
  accent,
  template = "classic",
  canDownloadSign = false,
  canStyle = false,
}: {
  eventId: string;
  slug: string;
  guestUrl: string;
  eventName: string;
  accent: string;
  template?: "classic" | "minimal" | "bold";
  canDownloadSign?: boolean;
  canStyle?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [style, setStyle] = useState<QrStyle>("classic");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const qrUrl = (size: number) => `/api/events/${eventId}/qr?format=png&size=${size}${style !== "classic" ? `&style=${style}` : ""}`;
  const invitation = `Add your photos and videos from ${eventName}: ${guestUrl}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(guestUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked; the link is shown above to copy by hand.
    }
  }

  async function run(label: string, make: () => Promise<Blob>, filename: string) {
    setBusy(label);
    setMessage(null);
    try {
      const result = await shareOrDownload(await make(), filename, invitation);
      setMessage(result === "downloaded" ? "Saved to your downloads." : null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That did not work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const fetchQr = async () => {
    const response = await fetch(qrUrl(1024));
    if (!response.ok) throw new Error("The QR code could not be made");
    return response.blob();
  };

  return (
    <Card className="flex max-w-md flex-col items-center gap-5 text-center">
      <div className="rounded-2xl bg-paper p-4">
        <Image src={qrUrl(480)} alt={`QR code linking to the ${slug} gallery`} width={240} height={240} unoptimized />
      </div>

      {canStyle && (
        <div className="flex gap-2" role="radiogroup" aria-label="QR style">
          {(Object.keys(STYLE_LABELS) as QrStyle[]).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={style === option}
              onClick={() => setStyle(option)}
              className={`min-h-11 rounded-full border px-4 text-sm transition-colors ${
                style === option ? "border-transparent bg-volt text-on-volt" : "border-canvas-line text-muted hover:text-paper"
              }`}
            >
              {STYLE_LABELS[option]}
            </button>
          ))}
        </div>
      )}

      <div className="w-full truncate rounded-xl border border-canvas-line bg-canvas px-3 py-2 text-sm text-muted">
        {guestUrl}
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={() => void run("share", fetchQr, `klik-${slug}.png`)} disabled={busy !== null} className="gap-2">
          <Share2 className="h-4 w-4" aria-hidden="true" />
          {busy === "share" ? "Preparing…" : "Share QR code"}
        </Button>
        <Button variant="ghost" onClick={() => void copyLink()}>
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>

      {/* Prefilled messages, for sending the link to a group before the day. */}
      <div className="flex flex-wrap justify-center gap-2">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(invitation)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClassName({ variant: "ghost", size: "sm", className: "gap-1.5" })}
        >
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
          WhatsApp
        </a>
        <a href={`sms:?&body=${encodeURIComponent(invitation)}`} className={buttonClassName({ variant: "ghost", size: "sm", className: "gap-1.5" })}>
          <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
          Messages
        </a>
        <a
          href={`mailto:?subject=${encodeURIComponent(`Photos from ${eventName}`)}&body=${encodeURIComponent(invitation)}`}
          className={buttonClassName({ variant: "ghost", size: "sm", className: "gap-1.5" })}
        >
          <Mail className="h-3.5 w-3.5" aria-hidden="true" />
          Email
        </a>
      </div>

      <div className="flex flex-wrap justify-center gap-3 border-t border-canvas-line pt-5">
        <a href={qrUrl(1024)} download className={buttonClassName({ variant: "ghost", size: "sm" })}>
          PNG
        </a>
        <a
          href={`/api/events/${eventId}/qr?format=svg${style !== "classic" ? `&style=${style}` : ""}`}
          download
          className={buttonClassName({ variant: "ghost", size: "sm" })}
        >
          SVG
        </a>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          onClick={() =>
            void run(
              "story",
              () => composeStory({ qrUrl: qrUrl(1024), eventName, guestUrl, accent }),
              `klik-${slug}-story.png`,
            )
          }
        >
          {busy === "story" ? "Drawing…" : "Story image"}
        </Button>
        {canDownloadSign && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              void run(
                "sign",
                () => composeSign({ qrUrl: qrUrl(1024), eventName, guestUrl, accent, template }),
                `klik-${slug}-sign.png`,
              )
            }
          >
            {busy === "sign" ? "Drawing…" : "Printable sign"}
          </Button>
        )}
      </div>
      {message && (
        <p className="text-xs text-muted" role="status">
          {message}
        </p>
      )}
    </Card>
  );
}
