import type { Metadata } from "next";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2 } from "@/lib/storage";
import { listDesigns } from "@/lib/print-designs";
import { PRINT_STUDIO_DRAFT_MESSAGE, PRINT_STUDIO_PLAN_MESSAGE } from "@/lib/print-access";
import { DesignLibrary } from "@/components/print/design-library";
import { StudioHolding } from "@/components/print/studio-holding";
import { loadStudioEvent } from "./access";

export const metadata: Metadata = { title: "Print studio", robots: { index: false } };

export default async function PrintStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadStudioEvent(id);
  if (loaded.state === "plan") {
    return <StudioHolding backHref={loaded.backHref} title="Print studio" detail={`${PRINT_STUDIO_PLAN_MESSAGE} Your QR code can still be downloaded from the event's QR code tab.`} />;
  }
  if (loaded.state === "draft") {
    return <StudioHolding backHref={loaded.backHref} title="Not yet" detail={PRINT_STUDIO_DRAFT_MESSAGE} />;
  }

  const rows = await listDesigns(loaded.event.id);
  const designs = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      name: row.name,
      preset: row.preset,
      widthMm: row.widthMm,
      heightMm: row.heightMm,
      updatedAt: row.updatedAt.toISOString(),
      thumbnailUrl: row.thumbnailKey
        ? await getSignedUrl(
            r2,
            new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: row.thumbnailKey, ResponseContentType: "image/jpeg" }),
            { expiresIn: 30 * 60 },
          )
        : null,
    })),
  );

  return (
    <DesignLibrary
      eventId={loaded.event.id}
      eventName={loaded.event.name}
      galleryUrl={loaded.galleryUrl}
      dateLabel={loaded.dateLabel}
      accent={loaded.accent}
      backHref={loaded.backHref}
      initialDesigns={designs}
    />
  );
}
