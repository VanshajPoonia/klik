import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { printOrders } from "@/lib/schema";
import { callbackTokenMatches, syncFromProdigi } from "@/lib/prints";
import { reportError } from "@/lib/observability";

export const runtime = "nodejs";

/**
 * GRW-6: Prodigi saying an order moved. Its callbacks are not signed, so each
 * order's URL carries a secret of its own, and the body is not believed: the
 * order is read from Prodigi's API instead.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ orderId: string; token: string }> }) {
  const { orderId, token } = await params;
  const [order] = await db.select().from(printOrders).where(eq(printOrders.id, orderId)).limit(1);
  if (!order || !callbackTokenMatches(order, token)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await syncFromProdigi(order.id);
  } catch (error) {
    reportError("prints.callback_failed", error, { orderId });
    return NextResponse.json({ error: "Try again" }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
