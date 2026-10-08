import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { consume } from "@/lib/ratelimit";
import { searchUsers } from "@/lib/account";

/**
 * ID-3: organizers by handle prefix, for the co-host picker. Signed-in only and
 * rate limited per account, so it is a way to find a colleague and not a way to
 * page through every account on Klik.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limit = await consume(`users:search:${session.user.id}`, 120, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many searches. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const matches = await searchUsers(q, session.user.id);
  return NextResponse.json(
    { users: matches.map(({ username, name }) => ({ username, name })) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
