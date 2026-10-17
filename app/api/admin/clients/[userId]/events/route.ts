import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, EVENT_VISIBILITIES } from "@/lib/schema";
import { requireSuperadmin } from "@/lib/roles";
import { createEvent, toOrganizerEvent } from "@/lib/events";
import { fieldsForTemplate, resolveTemplateChoice } from "@/lib/gallery-templates";
import { templateChoiceSchema, templateFieldsSchema } from "@/lib/template-fields";
import { recordAudit } from "@/lib/audit";
import { recordAccountEvent } from "@/lib/timeline";

/**
 * ADM-7: a new event on someone else's account, made by a superadmin. Always a
 * draft: putting it live is a grant, made from the same page with a reason,
 * exactly as for an event the owner made themselves.
 */

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  eventDate: z.coerce.date().nullable().optional(),
  visibility: z.enum(EVENT_VISIBILITIES).optional(),
  password: z.string().min(4).max(72).optional(),
  moderation: z.boolean().optional(),
  template: templateChoiceSchema.optional(),
  colorway: z.string().max(40).optional(),
  templateFields: templateFieldsSchema.optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { userId } = await params;

  const [account] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!account) return NextResponse.json({ error: "No such account" }, { status: 404 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form" }, { status: 400 });
  }
  if (parsed.data.visibility === "password" && !parsed.data.password) {
    return NextResponse.json({ error: "A password-protected gallery needs its password" }, { status: 400 });
  }
  const choice = parsed.data.template ? resolveTemplateChoice(parsed.data.template, parsed.data.colorway) : null;
  if (parsed.data.template && !choice) return NextResponse.json({ error: "That look is not available" }, { status: 400 });

  const event = await createEvent({
    ownerId: userId,
    name: parsed.data.name,
    eventDate: parsed.data.eventDate ?? null,
    visibility: parsed.data.visibility,
    password: parsed.data.password,
    moderation: parsed.data.moderation,
    retentionDays: null,
    ...(choice && choice.template.key !== "plain"
      ? { accentColor: choice.colorway.accent, backgroundColor: choice.colorway.background }
      : {}),
    templateKey: choice?.template.key ?? null,
    templateFields: choice ? fieldsForTemplate(choice.template, parsed.data.templateFields ?? null) : null,
  });

  await recordAudit({
    actor: session,
    action: "event.created_for_account",
    targetType: "event",
    targetId: event.id,
    eventId: event.id,
    detail: `Created "${event.name}" as a draft on the account.`,
  });
  await recordAccountEvent({
    userId,
    kind: "event_created",
    detail: `Klik created "${event.name}" as a draft on this account.`,
    actor: session.user.id ? { id: session.user.id, label: session.user.username ?? session.user.name ?? null } : null,
  });
  return NextResponse.json({ event: toOrganizerEvent(event) }, { status: 201 });
}
