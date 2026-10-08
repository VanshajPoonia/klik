import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog, events } from "@/lib/schema";
import { Card } from "@/components/ui/card";
import { AdminNav } from "@/components/admin/admin-nav";

export const metadata: Metadata = { title: "Audit log", robots: { index: false } };

/** ADM-4: the newest 200 audit entries. Who, what, when, and where it was. */
export default async function AdminAuditPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "superadmin") redirect("/dashboard");

  const rows = await db
    .select({ entry: auditLog, eventName: events.name })
    .from(auditLog)
    .leftJoin(events, eq(events.id, auditLog.eventId))
    .orderBy(desc(auditLog.createdAt))
    .limit(200);

  return (
    <div className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <AdminNav current="/admin/audit" />
        <Card className="divide-y divide-canvas-line p-0">
          {rows.length === 0 && <p className="px-4 py-6 text-sm text-muted">Nothing recorded yet.</p>}
          {rows.map(({ entry, eventName }) => (
            <div key={entry.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm text-paper">
                  <span className="font-medium">{entry.actorLabel ?? "Someone"}</span>{" "}
                  <span className="text-muted">{entry.action.replace(".", " ").replace("_", " ")}</span>
                  {eventName && entry.eventId && (
                    <>
                      {" on "}
                      <Link href={`/dashboard/events/${entry.eventId}`} className="underline underline-offset-2">
                        {eventName}
                      </Link>
                    </>
                  )}
                </p>
                <time className="text-xs tabular-nums text-muted" dateTime={entry.createdAt.toISOString()}>
                  {entry.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC
                </time>
              </div>
              {entry.detail && <p className="mt-0.5 text-xs text-muted">{entry.detail}</p>}
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
