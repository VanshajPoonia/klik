import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/roles";
import { listThreads, unreadForKlik } from "@/lib/messages";

/** MSG-1: every conversation, unread first. */
export async function GET() {
  if (!(await requireSuperadmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [threads, unread] = await Promise.all([listThreads(), unreadForKlik()]);
  return NextResponse.json({ threads, unread });
}
