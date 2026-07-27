import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { venueClients } from "@/lib/schema";
import { getAccountPlan } from "@/lib/account-plans";
import { canManageEventClients } from "@/lib/plans";

const clientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.union([z.literal(""), z.string().trim().email().max(254)]).optional(),
  phone: z.string().trim().max(40).optional(),
});

async function requireVenueOrganizer() {
  const session = await auth();
  if (!session?.user) return null;
  const plan = await getAccountPlan(session.user.id);
  return canManageEventClients(plan.key) ? session : null;
}

export async function GET() {
  const session = await requireVenueOrganizer();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db
    .select()
    .from(venueClients)
    .where(eq(venueClients.ownerId, session.user.id))
    .orderBy(venueClients.name);
  return NextResponse.json({ clients: rows });
}

export async function POST(request: Request) {
  const session = await requireVenueOrganizer();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = clientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid client details" },
      { status: 400 },
    );
  }

  const [client] = await db
    .insert(venueClients)
    .values({
      id: nanoid(),
      ownerId: session.user.id,
      name: parsed.data.name,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
    })
    .returning();
  return NextResponse.json({ client }, { status: 201 });
}
