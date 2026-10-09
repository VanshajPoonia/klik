import { NextResponse } from "next/server";
import { z } from "zod";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2 } from "@/lib/storage";
import { studioAccess } from "@/lib/print-access";
import {
  DesignError,
  checkDoc,
  createDesign,
  getDesign,
  listDesigns,
  resolveSize,
  toStudioDesign,
} from "@/lib/print-designs";
import { emptyDoc, upgradeDoc } from "@/lib/print/doc";
import { findPreset } from "@/lib/print/presets";
import { VOLT, eventDateLabel, findTemplate } from "@/lib/print/templates";
import { eventPlan } from "@/lib/license";
import { canCustomizeGallery } from "@/lib/plans";

/**
 * QR-4: an event's designs. GET lists them with a short-lived link to each
 * one's thumbnail; POST starts one from a template, from a blank page of a
 * size, or as a copy of another.
 */

const createSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  template: z.string().max(40).optional(),
  preset: z.string().max(40).optional(),
  widthMm: z.number().optional(),
  heightMm: z.number().optional(),
  duplicateOf: z.string().max(40).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await studioAccess(id);
  if (!access.ok) return access.response;

  const rows = await listDesigns(access.event.id);
  const designs = await Promise.all(
    rows.map(async (row) => ({
      ...toStudioDesign(row),
      // Signed fresh each time rather than on the gallery's rounded window:
      // a thumbnail changes under the same key, and a URL the browser had
      // cached would show the design as it was.
      thumbnailUrl: row.thumbnailKey
        ? await getSignedUrl(
            r2,
            new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: row.thumbnailKey, ResponseContentType: "image/jpeg" }),
            { expiresIn: 10 * 60 },
          )
        : null,
    })),
  );
  return NextResponse.json({ designs }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await studioAccess(id);
  if (!access.ok) return access.response;
  const { event, actor } = access;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a template or a size." }, { status: 400 });
  const input = parsed.data;

  try {
    if (input.duplicateOf) {
      const source = await getDesign(event.id, input.duplicateOf);
      const doc = source ? upgradeDoc(source.doc) : null;
      if (!source || !doc) return NextResponse.json({ error: "That design is not here any more." }, { status: 404 });
      const design = await createDesign({
        eventId: event.id,
        name: input.name ?? `${source.name} (copy)`.slice(0, 60),
        size: { preset: source.preset, widthMm: source.widthMm, heightMm: source.heightMm, bleedMm: source.bleedMm },
        doc,
        createdBy: actor.session.user.id,
      });
      return NextResponse.json({ design: toStudioDesign(design) }, { status: 201 });
    }

    if (input.template) {
      const template = findTemplate(input.template);
      if (!template) return NextResponse.json({ error: "That template is not available." }, { status: 404 });
      const accent = canCustomizeGallery(eventPlan(event).key) ? event.accentColor : VOLT;
      const doc = await checkDoc(
        event.id,
        template.build({ eventName: event.name, dateLabel: eventDateLabel(event.eventDate), accent }),
      );
      const design = await createDesign({
        eventId: event.id,
        name: input.name ?? template.name,
        size: resolveSize({ preset: template.preset }),
        doc,
        createdBy: actor.session.user.id,
      });
      return NextResponse.json({ design: toStudioDesign(design) }, { status: 201 });
    }

    const size = resolveSize({ preset: input.preset ?? "", widthMm: input.widthMm, heightMm: input.heightMm });
    const design = await createDesign({
      eventId: event.id,
      name: input.name ?? findPreset(size.preset)?.label ?? "Custom size",
      size,
      doc: emptyDoc(),
      createdBy: actor.session.user.id,
    });
    return NextResponse.json({ design: toStudioDesign(design) }, { status: 201 });
  } catch (error) {
    if (error instanceof DesignError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
