"use client";

import { useState } from "react";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Button, buttonClassName } from "@/components/ui/button";

export function VenueQrPanel({
  venueSlug,
  venueUrl,
}: {
  venueSlug: string;
  venueUrl: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(venueUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked; the link is still shown below to copy by hand.
    }
  }

  return (
    <Card className="mb-10 flex flex-col gap-6 md:flex-row md:items-center">
      <div className="shrink-0 rounded-2xl bg-paper p-3">
        <Image
          src="/api/venue/qr"
          alt={`Reusable QR code for ${venueSlug}`}
          width={168}
          height={168}
          unoptimized
        />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-xl text-paper">One code for every live event</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Feature an event in its settings. This permanent link will send guests there, and it
          stays ready for your next event.
        </p>
        <p className="mt-3 truncate rounded-lg border border-canvas-line bg-canvas px-3 py-2 text-xs text-muted">
          {venueUrl}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => void copyLink()}>
            {copied ? "Copied" : "Copy venue link"}
          </Button>
          <a
            href="/api/venue/qr"
            download
            className={buttonClassName({ variant: "ghost", size: "sm" })}
          >
            Download QR
          </a>
          <a
            href="/api/venue/qr?format=sign"
            download
            className={buttonClassName({ variant: "ghost", size: "sm" })}
          >
            Download venue sign
          </a>
        </div>
      </div>
    </Card>
  );
}
