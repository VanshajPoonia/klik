import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { getAppUrl } from "@/lib/env";
import { getAccountPlan } from "@/lib/account-plans";
import { canCustomizeQr, canDownloadQrSign } from "@/lib/plans";

export const runtime = "nodejs";

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[character];
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Rotating the slug invalidates every printed sign, so it belongs with settings rather than with moderation.
  const session = (await requireEventCapability(event.id, event.ownerId, "event.qr"))?.session ?? null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "svg" ? "svg" : "png";
  const wantsSign = url.searchParams.get("format") === "sign";
  const requestedSize = Number(url.searchParams.get("size")) || 1024;
  const size = Math.min(Math.max(requestedSize, 128), 4096);
  const target = `${getAppUrl()}/e/${event.slug}`;

  if (wantsSign) {
    const plan = await getAccountPlan(event.ownerId);
    if (!canDownloadQrSign(plan.key)) {
      return NextResponse.json(
        { error: "Formatted QR signs are available on Klik Premium and Klik Venue" },
        { status: 403 },
      );
    }

    const qr = await QRCode.toDataURL(target, {
      type: "image/png",
      width: 1000,
      margin: 2,
      color: { dark: "#090a08", light: "#ffffff" },
    });
    const template = canCustomizeQr(plan.key) ? event.qrTemplate : "classic";
    const isMinimal = template === "minimal";
    const isBold = template === "bold";
    const background = isBold ? event.accentColor : isMinimal ? "#ffffff" : "#090a08";
    const foreground = isBold || isMinimal ? "#090a08" : "#ffffff";
    const accent = isBold ? "#090a08" : event.accentColor;
    const titleSize = isBold ? 126 : 108;
    const safeName = escapeXml(event.name);
    const safeUrl = escapeXml(target);
    const svg = `
      <svg width="1800" height="2400" viewBox="0 0 1800 2400" xmlns="http://www.w3.org/2000/svg">
        <rect width="1800" height="2400" fill="${background}"/>
        <rect x="110" y="110" width="1580" height="18" rx="9" fill="${accent}"/>
        <text x="900" y="370" text-anchor="middle" fill="${foreground}" font-family="Arial, sans-serif" font-size="54" font-weight="700" letter-spacing="10">KLIK</text>
        <text x="900" y="610" text-anchor="middle" fill="${foreground}" font-family="Arial, sans-serif" font-size="${titleSize}" font-weight="800">${safeName}</text>
        <text x="900" y="735" text-anchor="middle" fill="${foreground}" opacity="0.72" font-family="Arial, sans-serif" font-size="48">Scan to share photos and videos</text>
        <rect x="300" y="880" width="1200" height="1200" rx="${isMinimal ? 24 : 90}" fill="#ffffff"/>
        <image href="${qr}" x="400" y="980" width="1000" height="1000"/>
        <text x="900" y="2225" text-anchor="middle" fill="${foreground}" opacity="0.72" font-family="Arial, sans-serif" font-size="34">${safeUrl}</text>
        <circle cx="900" cy="2305" r="13" fill="${accent}"/>
      </svg>
    `;
    // Imported here rather than at module scope. A failed native load at the
    // top of the file takes down every format this route serves, including the
    // plain QR PNG that never touches sharp. See lib/native-deps.test.ts.
    const sharp = (await import("sharp")).default;
    const sign = await sharp(Buffer.from(svg)).png().toBuffer();
    return new NextResponse(new Uint8Array(sign), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="klik-${event.slug}-sign.png"`,
      },
    });
  }

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
