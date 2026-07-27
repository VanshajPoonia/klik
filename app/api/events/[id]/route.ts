import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, media, EVENT_VISIBILITIES } from "@/lib/schema";
import { toPublicEvent, hashGalleryPassword } from "@/lib/events";
import { requireOwnerSession } from "@/lib/roles";
import { deleteBlobs } from "@/lib/storage";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  eventDate: z.coerce.date().nullable().optional(),
  visibility: z.enum(EVENT_VISIBILITIES).optional(),
  password: z.string().min(4).max(72).optional(),
  moderation: z.boolean().optional(),
  downloadsEnabled: z.boolean().optional(),
  uploadsEnabled: z.boolean().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

async function getOwnedEvent(id: string) {
  const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!event) return { event: null, session: null };
  const session = await requireOwnerSession(event.ownerId);
  return { event, session };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, session } = await getOwnedEvent(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ event: toPublicEvent(event) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, session } = await getOwnedEvent(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { password, ...rest } = parsed.data;
  const nextVisibility = rest.visibility ?? event.visibility;
  const enteringPasswordProtection =
    nextVisibility === "password" && event.visibility !== "password";
  if (
    nextVisibility === "password" &&
    !password &&
    (enteringPasswordProtection || !event.passwordHash)
  ) {
    return NextResponse.json(
      { error: "Password required for password-protected events" },
      { status: 400 },
    );
  }

  const passwordHashUpdate = password
    ? { passwordHash: await hashGalleryPassword(password) }
    : rest.visibility && rest.visibility !== "password"
      ? { passwordHash: null }
      : {};

  const [updated] = await db
    .update(events)
    .set({
      ...rest,
      ...passwordHashUpdate,
      updatedAt: new Date(),
    })
    .where(eq(events.id, id))
    .returning();

  return NextResponse.json({ event: toPublicEvent(updated) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, session } = await getOwnedEvent(id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({ pathname: media.blobPathname })
    .from(media)
    .where(eq(media.eventId, id));
  await deleteBlobs(rows.map((r) => r.pathname));
  await db.delete(events).where(eq(events.id, id));

  return NextResponse.json({ ok: true });
}
