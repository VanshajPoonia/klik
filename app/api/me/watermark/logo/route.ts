import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { watermarks } from "@/lib/schema";
import { r2 } from "@/lib/storage";

/**
 * MED-10: the signed-in photographer's own logo, from this origin, so the
 * account page can draw it into a canvas and make a new stamp. A signed R2 URL
 * would be cross-origin, and a canvas that draws one cannot be saved.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [row] = await db
    .select({ logoKey: watermarks.logoKey })
    .from(watermarks)
    .where(eq(watermarks.userId, session.user.id))
    .limit(1);
  if (!row?.logoKey) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const object = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: row.logoKey }));
  if (!object.Body) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(Buffer.from(await object.Body.transformToByteArray()), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
  });
}
