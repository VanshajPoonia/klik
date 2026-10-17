import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { listThreads, markRead, threadMessages } from "@/lib/messages";
import { AdminNav } from "@/components/admin/admin-nav";
import { Badge } from "@/components/ui/badge";
import { Conversation } from "@/components/messages/conversation";

export const metadata: Metadata = { title: "Messages", robots: { index: false } };

/**
 * MSG-1: every account's conversation with Klik, unread first. Opening one
 * marks it read for every superadmin, since Klik answers as one.
 */
export default async function AdminMessagesPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "superadmin") redirect("/dashboard");

  const { account: selectedId } = await searchParams;
  const [selected] = selectedId
    ? await db
        .select({ id: users.id, name: users.name, email: users.email, username: users.username, role: users.role })
        .from(users)
        .where(eq(users.id, selectedId))
        .limit(1)
    : [];
  const messages = selected && selected.role !== "superadmin" ? await threadMessages(selected.id) : [];
  if (selected) await markRead(selected.id, "klik");
  const threads = await listThreads();

  return (
    <div className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-5xl">
        <AdminNav current="/admin/messages" />
        <div className="grid gap-6 md:grid-cols-[18rem_minmax(0,1fr)]">
          <section aria-labelledby="threads-heading" className={selected ? "hidden md:block" : undefined}>
            <h1 id="threads-heading" className="mb-3 font-display text-2xl text-paper">
              Messages
            </h1>
            {threads.length === 0 ? (
              <p className="rounded-xl border border-dashed border-canvas-line px-4 py-6 text-center text-sm text-muted">
                Nobody has written yet. Organizers write from Messages on their dashboard.
              </p>
            ) : (
              <ul className="divide-y divide-canvas-line rounded-xl border border-canvas-line">
                {threads.map((thread) => (
                  <li key={thread.accountId}>
                    <Link
                      href={`/admin/messages?account=${encodeURIComponent(thread.accountId)}`}
                      aria-current={thread.accountId === selected?.id ? "true" : undefined}
                      className="block px-4 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-paper/5 aria-[current=true]:bg-paper/5"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-paper">
                          {thread.name || (thread.username ? `@${thread.username}` : thread.email) || "Unnamed account"}
                        </span>
                        {thread.unread > 0 ? <Badge tone="volt">{thread.unread}</Badge> : null}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-muted">
                        {thread.lastFromKlik ? "You: " : ""}
                        {thread.preview}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Conversation" className={selected ? undefined : "hidden md:block"}>
            {selected && selected.role !== "superadmin" ? (
              <div className="flex h-[min(44rem,calc(100dvh-10rem))] flex-col rounded-2xl border border-canvas-line p-3 sm:p-4">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-canvas-line pb-3">
                  <div className="min-w-0">
                    <Link href="/admin/messages" className="mb-1 inline-block text-xs text-muted hover:text-paper md:hidden">
                      All messages
                    </Link>
                    <p className="truncate text-sm font-medium text-paper">
                      {selected.name || (selected.username ? `@${selected.username}` : "Unnamed account")}
                    </p>
                    {selected.email && <p className="truncate text-xs text-muted">{selected.email}</p>}
                  </div>
                  <Link href={`/admin/clients/${selected.id}`} className="text-xs text-muted hover:text-paper">
                    Their page
                  </Link>
                </div>
                <Conversation
                  key={selected.id}
                  endpoint={`/api/admin/messages/${encodeURIComponent(selected.id)}`}
                  side="klik"
                  initialMessages={messages}
                  emptyText="Nothing here yet. Write first, and they are emailed that Klik wrote."
                  placeholder="Reply as Klik"
                />
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-canvas-line px-6 py-16 text-center text-sm text-muted">
                Pick a conversation.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
