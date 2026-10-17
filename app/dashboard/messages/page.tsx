import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { eventCoHosts, events } from "@/lib/schema";
import { markRead, threadMessages } from "@/lib/messages";
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "@/lib/support";
import { Conversation } from "@/components/messages/conversation";

export const metadata: Metadata = { title: "Messages", robots: { index: false } };

/**
 * MSG-1: an account's conversation with Klik. One thread, read by the people
 * who grant plans and run the platform, with a way to say which event a
 * message is about.
 */
export default async function MessagesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/dashboard/messages");
  if (session.user.role === "superadmin") redirect("/admin/messages");
  const userId = session.user.id;

  const [messages, mine] = await Promise.all([
    threadMessages(userId),
    db
      .select({ id: events.id, name: events.name })
      .from(events)
      .where(
        and(
          isNull(events.deletedAt),
          or(
            eq(events.ownerId, userId),
            sql`EXISTS (SELECT 1 FROM ${eventCoHosts} WHERE ${eventCoHosts.eventId} = ${events.id} AND ${eventCoHosts.userId} = ${userId} AND ${eventCoHosts.deletedAt} IS NULL)`,
          ),
        ),
      )
      .orderBy(desc(events.createdAt))
      .limit(50),
  ]);
  await markRead(userId, "account");

  return (
    <div className="flex h-dvh flex-col px-4 py-6 sm:px-6 md:px-10">
      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
        <header className="mb-4">
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted transition-colors hover:text-paper"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Your events
          </Link>
          <h1 className="mt-1 font-display text-2xl text-paper">Messages</h1>
          <p className="mt-1 text-sm text-muted">
            Write to Klik about anything: going live, your sign, a photo that should come down. A person reads every
            message. If your event is today, call or text{" "}
            <a href={SUPPORT_PHONE_HREF} className="font-medium text-paper hover:text-volt">
              {SUPPORT_PHONE}
            </a>
            .
          </p>
        </header>
        <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-canvas-line bg-canvas p-3 sm:p-4">
          <Conversation
            endpoint="/api/messages"
            side="account"
            initialMessages={messages}
            events={mine}
            emptyText="No messages yet. Say hello, or ask whatever you need."
            placeholder="Write to Klik"
          />
        </div>
      </div>
    </div>
  );
}
