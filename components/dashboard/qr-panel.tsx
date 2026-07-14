"use client";

import { useState } from "react";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function QrPanel({
  eventId,
  slug,
  guestUrl,
}: {
  eventId: string;
  slug: string;
  guestUrl: string;
}) {
  const [copied, setCopied] = useState(false);

  function copyLink() {
    navigator.clipboard.writeText(guestUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="flex max-w-md flex-col items-center gap-5 text-center">
      <div className="rounded-2xl bg-paper p-4">
        <Image
          src={`/api/events/${eventId}/qr?format=png&size=480`}
          alt={`QR code linking to the ${slug} gallery`}
          width={240}
          height={240}
          unoptimized
        />
      </div>
      <div className="w-full truncate rounded-xl border border-canvas-line bg-canvas px-3 py-2 text-sm text-muted">
        {guestUrl}
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button variant="ghost" onClick={copyLink}>
          {copied ? "Copied!" : "Copy link"}
        </Button>
        <a href={`/api/events/${eventId}/qr?format=png&size=1024`} download>
          <Button variant="ghost">Download PNG</Button>
        </a>
        <a href={`/api/events/${eventId}/qr?format=svg`} download>
          <Button variant="ghost">Download SVG</Button>
        </a>
      </div>
    </Card>
  );
}
