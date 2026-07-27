import { NextResponse } from "next/server";
import QRCode from "qrcode";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { getAccountPlan } from "@/lib/account-plans";
import { canUseVenueHub } from "@/lib/plans";
import { getAppUrl } from "@/lib/env";

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

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [account, plan] = await Promise.all([
    db
      .select({ name: users.name, venueSlug: users.venueSlug })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1)
      .then((rows) => rows[0]),
    getAccountPlan(session.user.id),
  ]);
  if (!account?.venueSlug || !canUseVenueHub(plan.key)) {
    return NextResponse.json({ error: "A Klik Venue plan is required" }, { status: 403 });
  }

  const target = `${getAppUrl()}/v/${account.venueSlug}`;
  const format = new URL(request.url).searchParams.get("format");
  if (format === "sign") {
    const qr = await QRCode.toDataURL(target, { type: "image/png", width: 1000, margin: 2 });
    const safeName = escapeXml(account.name || "Venue");
    const safeUrl = escapeXml(target);
    const svg = `
      <svg width="1800" height="2400" viewBox="0 0 1800 2400" xmlns="http://www.w3.org/2000/svg">
        <rect width="1800" height="2400" fill="#090a08"/>
        <rect x="110" y="110" width="1580" height="18" rx="9" fill="#e8f000"/>
        <text x="900" y="370" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="54" font-weight="700" letter-spacing="10">KLIK</text>
        <text x="900" y="600" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="116" font-weight="800">${safeName}</text>
        <text x="900" y="735" text-anchor="middle" fill="#ffffff" opacity="0.72" font-family="Arial, sans-serif" font-size="48">Scan for today&apos;s shared gallery</text>
        <rect x="300" y="880" width="1200" height="1200" rx="90" fill="#ffffff"/>
        <image href="${qr}" x="400" y="980" width="1000" height="1000"/>
        <text x="900" y="2225" text-anchor="middle" fill="#ffffff" opacity="0.72" font-family="Arial, sans-serif" font-size="34">${safeUrl}</text>
        <circle cx="900" cy="2305" r="13" fill="#e8f000"/>
      </svg>
    `;
    const sign = await sharp(Buffer.from(svg)).png().toBuffer();
    return new NextResponse(new Uint8Array(sign), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="klik-${account.venueSlug}-sign.png"`,
      },
    });
  }

  const buffer = await QRCode.toBuffer(target, {
    type: "png",
    width: 1024,
    margin: 1,
  });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="klik-${account.venueSlug}.png"`,
    },
  });
}
