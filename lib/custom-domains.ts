import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { customDomains, domainRemovals, users, type CustomDomain } from "./schema";
import { hasVenueGrant } from "./entitlements";
import { getAppUrl } from "./env";
import {
  VercelError,
  addProjectDomain,
  getDomainConfig,
  getProjectDomain,
  isDomainsConfigured,
  removeProjectDomain,
  verifyProjectDomain,
  type DomainConfig,
  type ProjectDomain,
} from "./vercel-domains";
import { log } from "./observability";

/**
 * VEN-3: a Venue account's own domain, `photos.thevenue.com`, serving its
 * venue hub and its galleries with the venue's name in the address bar.
 *
 * **What a custom domain serves.** The guest side only: the venue hub at `/`
 * (which goes on to the featured live gallery), galleries, share links, the
 * uploads behind them, and the policies. Anything else (sign-in, the
 * dashboard, admin) is sent to Klik's own domain, because sessions, passkeys
 * and sign-in links are bound to it and a venue's domain is not where anyone
 * should type a password. `proxy.ts` applies this.
 *
 * **Removal is the database's job**, as with Stream: a trigger queues every
 * deleted row's hostname, and `domains.reap` takes it off the Vercel project,
 * so an erased account cannot leave Klik answering for its old domain.
 */

export class DomainError extends Error {
  constructor(readonly code: "not_configured" | "invalid" | "taken" | "not_venue" | "exists" | "provider") {
    super(code);
  }
}

export const DOMAIN_REFUSALS: Record<DomainError["code"], string> = {
  not_configured: "Custom domains are not switched on yet",
  invalid: "Enter a domain like photos.yourvenue.com",
  taken: "That domain is already in use somewhere else on Vercel. Remove it there first, or use another.",
  not_venue: "Custom domains are part of Klik Venue",
  exists: "Your account already has a domain. Remove it to use another.",
  provider: "Vercel did not accept that just now. Try again in a minute.",
};

/** Lower-cased, without a scheme, path, port or trailing dot. Null if it is not a public hostname. */
export function normalizeHostname(input: string): string | null {
  let host = input.trim().toLowerCase();
  host = host.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/\.$/, "");
  if (host.length > 253 || !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
  return host;
}

/** Hostnames no venue may claim: Klik's own, and the platforms it runs on. */
export function isReservedHostname(host: string, appHost = appHostname()): boolean {
  const apex = (name: string | null) => (name ? name.split(".").slice(-2).join(".") : null);
  return (
    host === appHost ||
    (apex(appHost) !== null && (host === apex(appHost) || host.endsWith(`.${apex(appHost)}`))) ||
    /(^|\.)(vercel\.app|vercel\.com|cloudflarestream\.com|r2\.dev|localhost)$/.test(host)
  );
}

export function appHostname(): string | null {
  try {
    return new URL(getAppUrl()).hostname;
  } catch {
    return null;
  }
}

export interface DnsRecord {
  type: "A" | "CNAME" | "TXT";
  name: string;
  value: string;
}

/**
 * What the venue adds at their DNS provider: a CNAME for a subdomain, an A
 * record for an apex, each as Vercel recommends (rank 1), and the TXT record
 * when Vercel needs ownership proved.
 */
export function dnsRecordsFor(
  hostname: string,
  domain: Pick<ProjectDomain, "apexName" | "verified" | "verification">,
  config: Pick<DomainConfig, "recommendedCNAME" | "recommendedIPv4">,
): { records: DnsRecord[]; verification: DnsRecord[] } {
  const apex = domain.apexName || hostname;
  const isApex = hostname === apex;
  const label = isApex ? "@" : hostname.slice(0, -(apex.length + 1));
  const byRank = <T extends { rank: number }>(list: T[]) => [...list].sort((a, b) => a.rank - b.rank)[0];
  const records: DnsRecord[] = isApex
    ? [{ type: "A", name: "@", value: byRank(config.recommendedIPv4 ?? [])?.value?.[0] ?? "76.76.21.21" }]
    : [{ type: "CNAME", name: label, value: (byRank(config.recommendedCNAME ?? [])?.value ?? "cname.vercel-dns.com.").replace(/\.$/, "") }];
  const verification: DnsRecord[] = domain.verified
    ? []
    : (domain.verification ?? [])
        .filter((challenge) => challenge.type === "TXT")
        .map((challenge) => ({
          type: "TXT" as const,
          // The venue's DNS panel wants the name relative to the apex.
          name: challenge.domain === apex ? "@" : challenge.domain.replace(new RegExp(`\\.${apex.replace(/\./g, "\\.")}$`), ""),
          value: challenge.value,
        }));
  return { records, verification };
}

export async function domainFor(ownerId: string): Promise<CustomDomain | null> {
  const [row] = await db.select().from(customDomains).where(eq(customDomains.ownerId, ownerId)).limit(1);
  return row ?? null;
}

export async function addDomain(ownerId: string, input: string): Promise<CustomDomain> {
  if (!isDomainsConfigured()) throw new DomainError("not_configured");
  if (!(await hasVenueGrant(ownerId))) throw new DomainError("not_venue");
  const hostname = normalizeHostname(input);
  if (!hostname || isReservedHostname(hostname)) throw new DomainError("invalid");
  if (await domainFor(ownerId)) throw new DomainError("exists");
  const [clash] = await db.select({ id: customDomains.id }).from(customDomains).where(eq(customDomains.hostname, hostname)).limit(1);
  if (clash) throw new DomainError("taken");

  try {
    await addProjectDomain(hostname);
  } catch (error) {
    // Already on this project (a removal still queued, or a retry): fine.
    if (!(error instanceof VercelError && error.status === 400 && /already/i.test(error.message))) {
      if (error instanceof VercelError && error.status === 409) throw new DomainError("taken");
      log.warn("domains.add_failed", { hostname, error });
      throw new DomainError("provider");
    }
  }
  // A queued removal of this very name would take it away again.
  await db.delete(domainRemovals).where(eq(domainRemovals.hostname, hostname));
  const id = `dom_${nanoid()}`;
  await db.insert(customDomains).values({ id, ownerId, hostname });
  return refreshDomain(id);
}

/**
 * Asks Vercel where the domain stands, proves ownership when the TXT record
 * is in place, and records it. Active means verified and pointing at Vercel.
 */
export async function refreshDomain(id: string): Promise<CustomDomain> {
  const [row] = await db.select().from(customDomains).where(eq(customDomains.id, id)).limit(1);
  if (!row) throw new DomainError("invalid");
  if (!isDomainsConfigured()) return row;
  let domain = await getProjectDomain(row.hostname);
  if (!domain.verified && (domain.verification?.length ?? 0) > 0) {
    domain = await verifyProjectDomain(row.hostname).catch(() => domain);
  }
  const config = await getDomainConfig(row.hostname);
  const { records, verification } = dnsRecordsFor(row.hostname, domain, config);
  const configured = !config.misconfigured;
  const active = domain.verified && configured;
  const [updated] = await db
    .update(customDomains)
    .set({
      verified: domain.verified,
      configured,
      records,
      verification,
      checkedAt: new Date(),
      activeAt: active ? (row.activeAt ?? new Date()) : null,
    })
    .where(eq(customDomains.id, id))
    .returning();
  if (active && !row.activeAt) log.info("domains.active", { hostname: row.hostname });
  forgetHost(row.hostname);
  return updated;
}

export async function removeDomain(ownerId: string): Promise<boolean> {
  const removed = await db.delete(customDomains).where(eq(customDomains.ownerId, ownerId)).returning({ hostname: customDomains.hostname });
  for (const { hostname } of removed) forgetHost(hostname);
  // The trigger queued it; try now so the venue sees it gone, and leave the
  // queue to retry if Vercel is down.
  for (const { hostname } of removed) {
    await removeProjectDomain(hostname)
      .then(() => db.delete(domainRemovals).where(eq(domainRemovals.hostname, hostname)))
      .catch((error) => log.warn("domains.remove_deferred", { hostname, error }));
  }
  return removed.length > 0;
}

/** The daily job: takes queued hostnames off the project. */
export async function reapDomains(): Promise<void> {
  const queued = await db.select().from(domainRemovals).orderBy(asc(domainRemovals.queuedAt)).limit(200);
  if (queued.length === 0) return;
  if (!isDomainsConfigured()) {
    log.warn("domains.reap_unconfigured", { waiting: queued.length });
    return;
  }
  for (const row of queued) {
    // Claimed again by someone since: it stays.
    const [reclaimed] = await db.select({ id: customDomains.id }).from(customDomains).where(eq(customDomains.hostname, row.hostname)).limit(1);
    try {
      if (!reclaimed) await removeProjectDomain(row.hostname);
      await db.delete(domainRemovals).where(eq(domainRemovals.hostname, row.hostname));
    } catch (error) {
      await db.update(domainRemovals).set({ attempts: sql`${domainRemovals.attempts} + 1` }).where(eq(domainRemovals.hostname, row.hostname));
      log.warn("domains.reap_failed", { hostname: row.hostname, error });
    }
  }
}

/** Daily too: domains that were set up but not yet live get looked at again. */
export async function recheckPendingDomains(): Promise<void> {
  if (!isDomainsConfigured()) return;
  const pending = await db.select({ id: customDomains.id }).from(customDomains).where(sql`${customDomains.activeAt} IS NULL`).limit(100);
  for (const { id } of pending) await refreshDomain(id).catch((error) => log.warn("domains.recheck_failed", { id, error }));
}

/* ------------------------------------------------------------- proxy ---- */

const hostCache = new Map<string, { venueSlug: string | null; at: number }>();
const HOST_CACHE_MS = 60_000;

function forgetHost(hostname: string) {
  hostCache.delete(hostname);
}

/**
 * For `proxy.ts`: the venue a request's host belongs to, if it is an active
 * custom domain whose owner still holds a Venue grant. Kept a minute per
 * instance, so a gallery's hundreds of requests are one query.
 */
export async function venueForHost(hostname: string): Promise<string | null> {
  const hit = hostCache.get(hostname);
  if (hit && Date.now() - hit.at < HOST_CACHE_MS) return hit.venueSlug;
  const [row] = await db
    .select({ ownerId: customDomains.ownerId, venueSlug: users.venueSlug })
    .from(customDomains)
    .innerJoin(users, eq(users.id, customDomains.ownerId))
    .where(and(eq(customDomains.hostname, hostname), isNotNull(customDomains.activeAt)))
    .limit(1);
  const venueSlug = row?.venueSlug && (await hasVenueGrant(row.ownerId)) ? row.venueSlug : null;
  if (hostCache.size > 1000) hostCache.clear();
  hostCache.set(hostname, { venueSlug, at: Date.now() });
  return venueSlug;
}

/** Paths a custom domain serves; everything else goes to Klik's own domain. */
const GUEST_PATHS = [
  /^\/$/,
  /^\/(e|v|s|k|prints)\//,
  /^\/api\/(e|s|upload|kiosk|recap)(\/|$)/,
  /^\/api\/auth\/session$/,
  /^\/api\/unsubscribe$/,
  /^\/(privacy|terms|unsubscribe)$/,
  /^\/_next\//,
  /^\/(images|fonts)\//,
  /^\/[^/]+\.(js|png|jpe?g|svg|ico|webmanifest|txt)$/,
];

export function isGuestPath(pathname: string): boolean {
  return GUEST_PATHS.some((pattern) => pattern.test(pathname));
}

/** The address a venue's QR code and link should use: its own domain once live. */
export async function venueEntryUrl(ownerId: string, venueSlug: string): Promise<string> {
  const domain = await domainFor(ownerId);
  return domain?.activeAt ? `https://${domain.hostname}` : `${getAppUrl()}/v/${venueSlug}`;
}
