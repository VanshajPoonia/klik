import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, isNull, sum } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { events, users } from "@/lib/schema";
import { Card } from "@/components/ui/card";
import { AdminNav } from "@/components/admin/admin-nav";
import { eventPlan } from "@/lib/license";
import { eventUsage } from "@/lib/usage";
import { formatFileSize } from "@/lib/plans";

export const metadata: Metadata = { title: "Capacity", robots: { index: false } };

/** R2 standard storage, per GB-month. Egress is free, which is why it is R2. */
const R2_PER_GB_MONTH = 0.015;

/**
 * ADM-3: every live event by how full it is, fullest first, so the ones about
 * to refuse a guest's upload are at the top. Plus the platform total and what
 * it costs to keep, from the same counters the usage meter reads.
 */
export default async function AdminCapacityPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "superadmin") redirect("/dashboard");

  const [rows, [totals]] = await Promise.all([
    db
      .select({ event: events, ownerName: users.name, ownerEmail: users.email })
      .from(events)
      .innerJoin(users, eq(users.id, events.ownerId))
      .where(and(isNull(events.deletedAt)))
      .orderBy(desc(events.mediaBytes))
      .limit(200),
    db.select({ bytes: sum(events.mediaBytes).mapWith(Number) }).from(events),
  ]);
  const ranked = rows
    .map((row) => ({ ...row, usage: eventUsage(row.event, eventPlan(row.event)) }))
    .sort((a, b) => b.usage.storagePercent - a.usage.storagePercent);
  const totalBytes = totals?.bytes ?? 0;
  const monthly = (totalBytes / 1024 ** 3) * R2_PER_GB_MONTH;

  return (
    <div className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <AdminNav current="/admin/capacity" />
        <div className="mb-8 grid gap-3 sm:grid-cols-3">
          <Card>
            <p className="text-xs text-muted">Stored in galleries</p>
            <p className="mt-1 text-2xl font-semibold text-paper">{formatFileSize(totalBytes)}</p>
          </Card>
          <Card>
            <p className="text-xs text-muted">Storage cost, per month</p>
            <p className="mt-1 text-2xl font-semibold text-paper">${monthly.toFixed(2)}</p>
            <p className="mt-1 text-xs text-muted">Live media; the backup and trash add to it</p>
          </Card>
          <Card>
            <p className="text-xs text-muted">Events over 75%</p>
            <p className="mt-1 text-2xl font-semibold text-paper">{ranked.filter((row) => row.usage.level >= 75).length}</p>
          </Card>
        </div>
        <Card className="divide-y divide-canvas-line p-0">
          {ranked.length === 0 && <p className="px-4 py-6 text-sm text-muted">No events yet.</p>}
          {ranked.map(({ event, ownerName, ownerEmail, usage }) => (
            <Link key={event.id} href={`/dashboard/events/${event.id}`} className="block px-4 py-3 hover:bg-paper/5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm text-paper">{event.name}</p>
                <p className={`shrink-0 text-xs tabular-nums ${usage.level >= 90 ? "text-red-400" : usage.level >= 75 ? "text-amber-400" : "text-muted"}`}>
                  {usage.storagePercent}% · {formatFileSize(usage.bytes)} of {formatFileSize(usage.storageLimit)}
                </p>
              </div>
              <p className="truncate text-xs text-muted">
                {ownerName ?? "Unnamed"}
                {ownerEmail ? ` · ${ownerEmail}` : ""} · {usage.count} items
              </p>
            </Link>
          ))}
        </Card>
      </div>
    </div>
  );
}
