import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { consume } from "@/lib/ratelimit";
import { PROFILE_LIMITS, normalizeWebsite } from "@/lib/profiles";

const schema = z.object({
  isPublic: z.boolean(),
  bio: z.string().max(PROFILE_LIMITS.bio * 2).nullable().optional(),
  website: z.string().max(PROFILE_LIMITS.website * 2).nullable().optional(),
});

/** GRW-4: the signed-in account's public profile: on or off, and what it says. */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await consume(`profile:save:${session.user.id}`, 30, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many saves. Try again later." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const bio = parsed.data.bio?.replace(/\r\n/g, "\n").trim() || null;
  if (bio && bio.length > PROFILE_LIMITS.bio) {
    return NextResponse.json({ error: `Keep it to ${PROFILE_LIMITS.bio} characters.` }, { status: 400 });
  }
  const website = normalizeWebsite(parsed.data.website);
  if (!website.ok) return NextResponse.json({ error: "The website must be an https:// address." }, { status: 400 });

  const [account] = await db.select({ username: users.username }).from(users).where(eq(users.id, session.user.id)).limit(1);
  if (parsed.data.isPublic && !account?.username) {
    return NextResponse.json({ error: "Choose a username first: it is your profile's address." }, { status: 400 });
  }

  await db
    .update(users)
    .set({ profilePublic: parsed.data.isPublic, profileBio: bio, profileWebsite: website.url })
    .where(eq(users.id, session.user.id));
  return NextResponse.json({ profile: { isPublic: parsed.data.isPublic, bio, website: website.url, username: account?.username ?? null } });
}
