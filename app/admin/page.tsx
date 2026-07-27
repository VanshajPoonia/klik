import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { auth, signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, events } from "@/lib/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CtaLink } from "@/components/marketing/cta-link";
import { ResetPasswordControl } from "@/components/admin/reset-password-control";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "superadmin") redirect("/dashboard");

  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      contactName: users.name,
      eventId: events.id,
      eventName: events.name,
      eventSlug: events.slug,
      visibility: events.visibility,
      expiresAt: events.expiresAt,
      createdAt: events.createdAt,
    })
    .from(events)
    .innerJoin(users, eq(events.ownerId, users.id))
    .where(eq(users.role, "organizer"))
    .orderBy(desc(events.createdAt));

  return (
    <div className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Image src="/klik-mark.png" alt="" width={32} height={32} className="rounded-[8px]" />
            <span className="text-lg font-semibold tracking-tight text-paper">
              klik <span className="font-normal text-muted">admin</span>
            </span>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button className="text-sm text-muted hover:text-paper">Sign out</button>
          </form>
        </header>

        <div className="mb-8 flex items-center justify-between">
          <h1 className="font-display text-2xl text-paper">Provisioned clients</h1>
          <CtaLink href="/admin/new">New client</CtaLink>
        </div>

        <div className="space-y-3">
          {rows.length === 0 && (
            <Card className="text-center text-sm text-muted">
              No clients yet - provision your first venue to hand off a QR code and login.
            </Card>
          )}
          {rows.map((row) => (
            <Card key={row.eventId} className="space-y-4 transition-colors hover:border-paper/30">
              <Link
                href={`/dashboard/events/${row.eventId}`}
                className="-m-2 flex items-center justify-between gap-4 rounded-lg p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-paper">{row.contactName}</p>
                  <p className="truncate text-xs text-muted">
                    {row.eventName} · /e/{row.eventSlug} · @{row.username}
                  </p>
                </div>
                <Badge tone={row.visibility === "public" ? "volt" : "neutral"}>
                  {row.visibility}
                </Badge>
              </Link>
              {row.username && (
                <ResetPasswordControl userId={row.userId} username={row.username} />
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
