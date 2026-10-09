import Link from "next/link";
import { Printer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { buttonClassName } from "@/components/ui/button";

/** QR-4: the way into the print studio, beside the QR code it puts on paper. */
export function PrintStudioCard({ eventId, available }: { eventId: string; available: boolean }) {
  return (
    <Card className="max-w-md space-y-4">
      <div className="flex items-start gap-3">
        <Printer className="mt-0.5 h-5 w-5 shrink-0 text-volt" aria-hidden="true" />
        <div>
          <h2 className="font-medium text-paper">Print studio</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Posters, table cards, stickers and signs with this QR code on them, from eleven ready templates. Export a
            print-ready PDF, checked so the code scans and nothing is lost to the cut.
          </p>
        </div>
      </div>
      {available ? (
        <Link href={`/dashboard/events/${eventId}/print`} className={buttonClassName({ size: "sm" })}>
          Open the print studio
        </Link>
      ) : (
        <p className="text-xs text-muted">Part of Klik Premium and Klik Venue.</p>
      )}
    </Card>
  );
}
