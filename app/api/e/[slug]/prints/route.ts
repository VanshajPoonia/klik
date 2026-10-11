import { NextResponse } from "next/server";
import { z } from "zod";
import { findEventBySlug } from "@/lib/slugs";
import { resolveEventViewer } from "@/lib/event-viewer";
import { auth } from "@/lib/auth";
import { clientIp, consume } from "@/lib/ratelimit";
import { MAX_COPIES, MAX_ORDER_LINES, PRINT_REFUSALS, PrintError, startOrder } from "@/lib/prints";
import { reportError } from "@/lib/observability";
import { appHostname, venueForHost } from "@/lib/custom-domains";
import { getAppUrl } from "@/lib/env";

const schema = z.object({
  lines: z
    .array(z.object({ mediaId: z.string().min(1).max(64), product: z.string().min(1).max(10), copies: z.number().int().min(1).max(MAX_COPIES) }))
    .min(1)
    .max(MAX_ORDER_LINES),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  locale: z.enum(["en", "es"]).optional(),
});

/**
 * GRW-6: a guest (or the team) orders prints. Answers with Stripe's hosted
 * checkout to go to; nothing is recorded as paid until Stripe says so.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = await findEventBySlug(slug);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { event } = found;
  const viewer = await resolveEventViewer(event);
  if (!viewer.access.allowed) return NextResponse.json({ error: viewer.access.reason }, { status: 403 });
  if (!viewer.ownerSession && !viewer.guestId) return NextResponse.json({ error: "Join the gallery first" }, { status: 401 });
  if (viewer.kioskId) return NextResponse.json({ error: "Not on a kiosk" }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: PRINT_REFUSALS.empty }, { status: 400 });

  // Each try opens a Stripe session; a script opening thousands is a nuisance.
  const gate = await consume(`prints:${event.id}:${viewer.guestId ?? viewer.ownerSession?.user?.id ?? clientIp(request)}`, 10, 60 * 60);
  if (!gate.allowed) return NextResponse.json({ error: "Too many tries. Wait a while." }, { status: 429 });

  const account = await auth();
  // VEN-3: back to the venue's own domain when that is where they ordered.
  // The proxy only lets a host this far when it is Klik's or a live venue's.
  const host = (request.headers.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  const origin = host && host !== appHostname() && (await venueForHost(host)) ? `https://${host}` : getAppUrl();
  try {
    const { url, orderId } = await startOrder({
      event,
      viewer: { isManager: Boolean(viewer.ownerSession), guestId: viewer.guestId, userId: account?.user?.id ?? null },
      lines: parsed.data.lines,
      email: parsed.data.email ?? account?.user?.email ?? null,
      locale: parsed.data.locale,
      origin,
    });
    return NextResponse.json({ url, orderId }, { status: 201 });
  } catch (error) {
    if (error instanceof PrintError) {
      const status = error.code === "unavailable" ? 503 : error.code === "not_allowed" ? 403 : 400;
      return NextResponse.json({ error: PRINT_REFUSALS[error.code], code: error.code }, { status });
    }
    reportError("prints.start_failed", error, { eventId: event.id });
    return NextResponse.json({ error: "That did not work. Try again." }, { status: 502 });
  }
}
