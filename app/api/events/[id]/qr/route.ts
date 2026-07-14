import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { requireOwnerSession } from "@/lib/roles";
import { getAppUrl } from "@/lib/env";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const session = await requireOwnerSession(event.ownerId);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "svg" ? "svg" : "png";
  const size = Number(url.searchParams.get("size")) || 1024;
  const target = `${getAppUrl()}/e/${event.slug}`;

  if (format === "svg") {
    const svg = await QRCode.toString(target, { type: "svg", width: size, margin: 1 });
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Disposition": `attachment; filename="klik-${event.slug}.svg"`,
      },
    });
  }

  const buffer = await QRCode.toBuffer(target, { type: "png", width: size, margin: 1 });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="klik-${event.slug}.png"`,
    },
  });
}
