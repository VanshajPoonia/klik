import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { venueClients } from "@/lib/schema";
import { getAccountPlan } from "@/lib/account-plans";
import { canManageEventClients } from "@/lib/plans";

const patchClientSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.union([z.literal(""), z.string().trim().email().max(254)]).optional(),
  phone: z.string().trim().max(40).optional(),
});

async function requireVenueOrganizer() {
  const session = await auth();
  if (!session?.user) return null;
  const plan = await getAccountPlan(session.user.id);
  return canManageEventClients(plan.key) ? session : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const session = await requireVenueOrganizer();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { clientId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = patchClientSchema.safeParse(body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Invalid client details" }, { status: 400 });
  }

  const [client] = await db
    .update(venueClients)
    .set({
      ...parsed.data,
      email: parsed.data.email === "" ? null : parsed.data.email,
      phone: parsed.data.phone === "" ? null : parsed.data.phone,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(venueClients.id, clientId),
        eq(venueClients.ownerId, session.user.id),
      ),
    )
    .returning();
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  return NextResponse.json({ client });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const session = await requireVenueOrganizer();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { clientId } = await params;

  // Soft delete. Events reference a client with ON DELETE SET NULL, so a hard
  // delete detached every event that client ever had, along with their contact
  // details, with no way back.
  const [deleted] = await db
    .update(venueClients)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(venueClients.id, clientId),
        eq(venueClients.ownerId, session.user.id),
        isNull(venueClients.deletedAt),
      ),
    )
    .returning({ id: venueClients.id });
  if (!deleted) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
