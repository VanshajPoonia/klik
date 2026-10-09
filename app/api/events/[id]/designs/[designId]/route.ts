import { NextResponse } from "next/server";
import { z } from "zod";
import { studioAccess } from "@/lib/print-access";
import { DesignError, checkDoc, deleteDesign, getDesign, saveDesign, toStudioDesign } from "@/lib/print-designs";
import { upgradeDoc } from "@/lib/print/doc";

/**
 * QR-4a: one design. PATCH is the autosave: it carries the revision the
 * browser's copy was made from, and a save from a copy someone else has moved
 * past is refused with what is stored now, so the host can choose which to keep.
 */

const patchSchema = z.object({
  doc: z.unknown().optional(),
  name: z.string().trim().min(1).max(60).optional(),
  baseRevision: z.number().int().min(1),
  force: z.boolean().optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; designId: string }> }) {
  const { id, designId } = await params;
  const access = await studioAccess(id);
  if (!access.ok) return access.response;
  const design = await getDesign(access.event.id, designId);
  const doc = design ? upgradeDoc(design.doc) : null;
  if (!design || !doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ design: { ...toStudioDesign(design), doc } }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; designId: string }> }) {
  const { id, designId } = await params;
  const access = await studioAccess(id);
  if (!access.ok) return access.response;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (parsed.data.doc === undefined && !parsed.data.name)) {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }

  try {
    const doc = parsed.data.doc === undefined ? undefined : await checkDoc(access.event.id, parsed.data.doc);
    const result = await saveDesign(
      access.event.id,
      designId,
      { doc, name: parsed.data.name },
      { baseRevision: parsed.data.baseRevision, force: parsed.data.force },
    );
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!result.ok) {
      return NextResponse.json(
        {
          error: "This design was changed somewhere else since you opened it.",
          current: { ...toStudioDesign(result.current), doc: upgradeDoc(result.current.doc) },
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ design: toStudioDesign(result.design) });
  } catch (error) {
    if (error instanceof DesignError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; designId: string }> }) {
  const { id, designId } = await params;
  const access = await studioAccess(id);
  if (!access.ok) return access.response;
  const removed = await deleteDesign(access.event.id, designId);
  if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
