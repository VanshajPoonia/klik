import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDesign, listAssets, toStudioAsset } from "@/lib/print-designs";
import { PRINT_STUDIO_DRAFT_MESSAGE, PRINT_STUDIO_PLAN_MESSAGE } from "@/lib/print-access";
import { upgradeDoc } from "@/lib/print/doc";
import { StudioHolding } from "@/components/print/studio-holding";
import { StudioLoader } from "@/components/print/studio-loader";
import { loadStudioEvent } from "../access";

export const metadata: Metadata = { title: "Print studio", robots: { index: false } };

export default async function DesignPage({ params }: { params: Promise<{ id: string; designId: string }> }) {
  const { id, designId } = await params;
  const loaded = await loadStudioEvent(id);
  const libraryHref = `/dashboard/events/${id}/print`;
  if (loaded.state === "plan") return <StudioHolding backHref={loaded.backHref} title="Print studio" detail={PRINT_STUDIO_PLAN_MESSAGE} />;
  if (loaded.state === "draft") return <StudioHolding backHref={loaded.backHref} title="Not yet" detail={PRINT_STUDIO_DRAFT_MESSAGE} />;

  const design = await getDesign(loaded.event.id, designId);
  if (!design) notFound();
  const doc = upgradeDoc(design.doc);
  if (!doc) {
    return <StudioHolding backHref={libraryHref} title="This design could not be opened" detail="It was saved in a shape this version of the studio cannot read. Start a new one from a template." />;
  }
  const assets = (await listAssets(loaded.event.id)).map((asset) => toStudioAsset(loaded.event.id, asset));

  return (
    <StudioLoader
      eventId={loaded.event.id}
      slug={loaded.event.slug}
      eventName={loaded.event.name}
      galleryUrl={loaded.galleryUrl}
      accent={loaded.accent}
      design={{
        id: design.id,
        name: design.name,
        preset: design.preset,
        widthMm: design.widthMm,
        heightMm: design.heightMm,
        bleedMm: design.bleedMm,
        revision: design.revision,
      }}
      initialDoc={doc}
      initialAssets={assets}
      libraryHref={libraryHref}
    />
  );
}
