import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** What the studio shows instead of itself on a plan without it, or before the event is live. */
export function StudioHolding({ backHref, title, detail }: { backHref: string; title: string; detail: string }) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 pt-10 md:px-10">
      <Link href={backHref} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-muted transition-colors hover:text-paper">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to the event
      </Link>
      <div className="mt-10 max-w-md rounded-2xl border border-dashed border-canvas-line px-6 py-10 text-center">
        <p className="font-medium text-paper">{title}</p>
        <p className="mt-2 text-sm text-muted">{detail}</p>
      </div>
    </main>
  );
}
