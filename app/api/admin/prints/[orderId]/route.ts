import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { printOrders } from "@/lib/schema";
import { requireSuperadmin } from "@/lib/roles";
import { PRINT_REFUSALS, PrintError, confirmPayment, prodigiCost, refundOrder, submitOrder } from "@/lib/prints";
import { recordAudit } from "@/lib/audit";
import { reportError } from "@/lib/observability";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("quote") }),
  z.object({ action: z.literal("recheck") }),
  z.object({ action: z.literal("submit"), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("refund"), note: z.string().trim().min(3).max(500) }),
]);

/**
 * GRW-6: Klik's person on a print order. `quote` asks Prodigi what it will
 * cost Klik; `submit` sends it to the printer; `refund` returns the money
 * instead. Never automatic, as BILLING.md says of every payment.
 */
export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const { orderId } = await params;
  const [order] = await db.select().from(printOrders).where(eq(printOrders.id, orderId)).limit(1);
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    switch (parsed.data.action) {
      case "quote":
        return NextResponse.json({ cost: await prodigiCost(order) });
      case "recheck":
        return NextResponse.json({ order: await confirmPayment(order.id) });
      case "submit": {
        const updated = await submitOrder(order.id, session.user.id);
        await recordAudit({ actor: session, action: "prints.submitted", targetType: "user", targetId: order.userId, eventId: order.eventId, detail: `${order.id}. ${parsed.data.note ?? ""}`.trim() });
        return NextResponse.json({ order: updated });
      }
      case "refund": {
        const updated = await refundOrder(order.id, session.user.id, parsed.data.note);
        await recordAudit({ actor: session, action: "prints.refunded", targetType: "user", targetId: order.userId, eventId: order.eventId, detail: `${order.id}. ${parsed.data.note}` });
        return NextResponse.json({ order: updated });
      }
    }
  } catch (error) {
    if (error instanceof PrintError) return NextResponse.json({ error: PRINT_REFUSALS[error.code] }, { status: 409 });
    reportError("prints.admin_failed", error, { orderId });
    return NextResponse.json({ error: error instanceof Error ? error.message.slice(0, 300) : "That did not work" }, { status: 502 });
  }
}
