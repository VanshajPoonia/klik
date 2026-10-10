import Link from "next/link";

const LINKS = [
  { href: "/admin", label: "Queues and clients" },
  { href: "/admin/search", label: "Search" },
  { href: "/admin/capacity", label: "Capacity" },
  { href: "/admin/revenue", label: "Revenue" },
  { href: "/admin/audit", label: "Audit log" },
] as const;

/** The admin sections. A row of links, because there are few and they fit. */
export function AdminNav({ current }: { current: (typeof LINKS)[number]["href"] }) {
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
        </Link>
      ))}
    </nav>
  );
}
