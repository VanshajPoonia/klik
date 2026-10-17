import Link from "next/link";
import { unreadForKlik } from "@/lib/messages";

const LINKS = [
  { href: "/admin", label: "Queues and clients" },
  { href: "/admin/messages", label: "Messages" },
  { href: "/admin/events", label: "Events" },
  { href: "/admin/search", label: "Search" },
  { href: "/admin/capacity", label: "Capacity" },
  { href: "/admin/revenue", label: "Revenue" },
  { href: "/admin/audit", label: "Audit log" },
] as const;

/**
 * The admin sections. A row of links, because there are few and they fit.
 * Messages carries how many are waiting (MSG-1), read on every admin page so
 * a new one is seen wherever a superadmin happens to be.
 */
export async function AdminNav({ current }: { current: (typeof LINKS)[number]["href"] }) {
  const unread = await unreadForKlik().catch(() => 0);
  return (
    <nav aria-label="Admin sections" className="mb-8 flex flex-wrap gap-2">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={current === link.href ? "page" : undefined}
          className={`min-h-11 rounded-full border px-4 py-2.5 text-sm transition-colors ${
            current === link.href ? "border-transparent bg-volt text-on-volt" : "border-canvas-line text-muted hover:text-paper"
          }`}
        >
          {link.label}
          {link.href === "/admin/messages" && unread > 0 && (
            <span className="ml-1.5 rounded-full bg-volt px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-on-volt">
              {unread}
              <span className="sr-only"> unread</span>
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
