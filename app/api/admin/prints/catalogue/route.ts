import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/roles";
import { checkCatalogue } from "@/lib/prints";
import { isProdigiConfigured } from "@/lib/prodigi";

/** GRW-6: whether each print SKU exists at Prodigi and ships to the US. */
export async function POST() {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isProdigiConfigured()) return NextResponse.json({ error: "Prodigi is not configured" }, { status: 503 });
  return NextResponse.json({ products: await checkCatalogue() });
}
