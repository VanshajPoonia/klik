import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { consume } from "@/lib/ratelimit";
import { getAppUrl } from "@/lib/env";
import { accountExport } from "@/lib/data-export";

/**
 * TRS-2: everything Klik holds about the signed-in account, as one JSON file.
 * What it shared as a guest is linked from inside it, one download per
 * gallery, so this stays a file rather than gigabytes.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await consume(`export:account:${session.user.id}`, 10, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Try again in an hour." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }

  const data = await accountExport(session.user.id, getAppUrl());
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="klik-account-${day}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
