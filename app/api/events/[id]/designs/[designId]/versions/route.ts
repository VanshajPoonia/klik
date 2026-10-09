import { NextResponse } from "next/server";
import { z } from "zod";
import { studioAccess } from "@/lib/print-access";
import { DesignError, getDesign, listVersions, restoreVersion, toStudioDesign } from "@/lib/print-designs";
import { upgradeDoc } from "@/lib/print/doc";

/** QR-4a: the last ten earlier states of a design, and putting one back. */

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; designId: string }> }) {
  const { id, designId } = await params;
  const access = await studioAccess(id);
  if (!access.ok) return access.response;
  if (!(await getDesign(access.event.id, designId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const versions = await listVersions(designId);
  return NextResponse.json({
    versions: versions.map((version) => ({ ...version, createdAt: version.createdAt.toISOString() })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; designId: string }> }) {
  const { id, designId } = await params;
  const access = await studioAccess(id);
  if (!access.ok) return access.response;
  const parsed = z.object({ versionId: z.string().min(1).max(40) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a version." }, { status: 400 });
  try {
    const design = await restoreVersion(access.event.id, designId, parsed.data.versionId);
    if (!design) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ design: { ...toStudioDesign(design), doc: upgradeDoc(design.doc) } });
  } catch (error) {
    if (error instanceof DesignError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
