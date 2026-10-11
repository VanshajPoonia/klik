import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { consume } from "@/lib/ratelimit";
import { DOMAIN_REFUSALS, DomainError, addDomain, domainFor, refreshDomain, removeDomain } from "@/lib/custom-domains";
import { isDomainsConfigured } from "@/lib/vercel-domains";
import { recordAudit } from "@/lib/audit";
import { reportError } from "@/lib/observability";
import type { CustomDomain } from "@/lib/schema";

const noStore = { "Cache-Control": "no-store" };

function view(domain: CustomDomain | null) {
  if (!domain) return null;
  return {
    hostname: domain.hostname,
    active: Boolean(domain.activeAt),
    verified: domain.verified,
    configured: domain.configured,
    records: domain.records ?? [],
    verification: domain.verification ?? [],
    checkedAt: domain.checkedAt?.toISOString() ?? null,
  };
}

function refusal(error: unknown) {
  if (error instanceof DomainError) {
    const status = error.code === "not_configured" ? 503 : error.code === "not_venue" ? 403 : error.code === "invalid" ? 400 : error.code === "provider" ? 502 : 409;
    return NextResponse.json({ error: DOMAIN_REFUSALS[error.code], code: error.code }, { status, headers: noStore });
  }
  reportError("domains.request_failed", error);
  return NextResponse.json({ error: DOMAIN_REFUSALS.provider }, { status: 502, headers: noStore });
}

/** VEN-3: the account's own domain and where it stands. */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  return NextResponse.json({ available: isDomainsConfigured(), domain: view(await domainFor(session.user.id)) }, { headers: noStore });
}

const addSchema = z.object({ hostname: z.string().min(3).max(260) });

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: DOMAIN_REFUSALS.invalid }, { status: 400, headers: noStore });
  const gate = await consume(`domain-add:${session.user.id}`, 10, 60 * 60);
  if (!gate.allowed) return NextResponse.json({ error: "Too many tries. Wait a while." }, { status: 429, headers: noStore });
  try {
    const domain = await addDomain(session.user.id, parsed.data.hostname);
    await recordAudit({ actor: session, action: "domain.added", targetType: "user", targetId: session.user.id, detail: domain.hostname });
    return NextResponse.json({ domain: view(domain) }, { status: 201, headers: noStore });
  } catch (error) {
    return refusal(error);
  }
}

/** Looks again now, after the venue has changed their DNS. */
export async function PATCH() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  const domain = await domainFor(session.user.id);
  if (!domain) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
  const gate = await consume(`domain-check:${session.user.id}`, 1, 10);
  if (!gate.allowed) return NextResponse.json({ domain: view(domain) }, { headers: noStore });
  try {
    return NextResponse.json({ domain: view(await refreshDomain(domain.id)) }, { headers: noStore });
  } catch (error) {
    return refusal(error);
  }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  const domain = await domainFor(session.user.id);
  if (!(await removeDomain(session.user.id))) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
  await recordAudit({ actor: session, action: "domain.removed", targetType: "user", targetId: session.user.id, detail: domain?.hostname ?? null });
  return NextResponse.json({ ok: true }, { headers: noStore });
}
