import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth, signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { CreateEventForm } from "@/components/dashboard/create-event-form";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAccountPlan } from "@/lib/account-plans";
import { isExpired } from "@/lib/access";
import { formatFileSize } from "@/lib/plans";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const rows = await db
    .select()
    .from(events)
    .where(eq(events.ownerId, session.user.id))
    .orderBy(events.createdAt);
  const plan = await getAccountPlan(session.user.id);
  const activeEventCount = rows.filter(
    (event) => !isExpired(event, plan.galleryAccessDays),
  ).length;
  const canCreateEvent = activeEventCount < plan.maxActiveEvents;

  return (
    <div className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Image src="/klik-mark.png" alt="" width={32} height={32} className="rounded-[8px]" />
            <span className="text-lg font-semibold tracking-tight">klik</span>
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

        <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <h1 className="font-display text-2xl text-paper">Your events</h1>
            <p className="mt-2 text-sm text-muted">
              View, moderate, download, and manage every event from here.
            </p>
          </div>
          <div className="rounded-xl border border-volt/30 bg-volt/10 px-4 py-3 sm:text-right">
            <p className="text-xs font-medium text-volt">{plan.name}</p>
            <p className="mt-1 text-sm text-paper">
              {activeEventCount} of {plan.maxActiveEvents} active{" "}
              {plan.maxActiveEvents === 1 ? "event" : "events"}
            </p>
            <p className="mt-1 text-xs text-muted">
              {plan.uploadWindowDays}-day uploads · {formatFileSize(plan.maxVideoBytes)} videos
            </p>
          </div>
        </div>

        <div className="mb-10">
          <CreateEventForm
            canCreate={canCreateEvent}
            limitMessage={
              canCreateEvent
                ? undefined
                : `${plan.name} has reached its active event limit. Ask an administrator to change the plan or wait for an event to end.`
            }
          />
        </div>

        <div className="space-y-3">
          {rows.length === 0 && (
            <Card className="text-center text-sm text-muted">
              No events yet. Create your first one above.
            </Card>
          )}
          {rows.map((event) => (
            <Link key={event.id} href={`/dashboard/events/${event.id}`}>
              <Card className="flex items-center justify-between transition-colors hover:border-paper/30">
                <div>
                  <p className="font-medium text-paper">{event.name}</p>
                  <p className="text-xs text-muted">/e/{event.slug}</p>
                </div>
                <Badge tone={event.visibility === "public" ? "volt" : "neutral"}>
                  {event.visibility}
                </Badge>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
