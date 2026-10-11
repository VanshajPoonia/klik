import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/roles";
import { reportError } from "@/lib/observability";

/**
 * F-9: one deliberate error, so a superadmin can see that Sentry and the email
 * alerts both hear about failures without waiting for a real one. Reported,
 * not thrown: nothing breaks.
 */
export async function POST() {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  reportError("ops.test_error", new Error("A test error sent from /admin"), { userId: session.user.id });
  return NextResponse.json({ ok: true, sentry: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN), email: Boolean(process.env.ALERT_EMAIL) });
}
