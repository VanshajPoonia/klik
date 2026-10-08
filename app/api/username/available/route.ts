import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { clientIp, consume } from "@/lib/ratelimit";
import { usernameAvailability } from "@/lib/account";

/**
 * ID-2: whether a handle could be taken. Rate limited per address, because a
 * free oracle for "does this handle exist" is a list of handles, slowly.
 */
export async function GET(request: Request) {
  const limit = await consume(`username:available:${clientIp(request)}`, 60, 10 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many checks. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  const raw = new URL(request.url).searchParams.get("u") ?? "";
  const session = await auth();
  const result = await usernameAvailability(raw, session?.user?.id ?? null);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
