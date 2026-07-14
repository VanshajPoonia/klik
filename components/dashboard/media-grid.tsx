import Image from "next/image";
import type { Media } from "@/lib/schema";

export function MediaGrid({
  items,
  onApprove,
  onReject,
  onDelete,
}: {
  items: Media[];
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.id}
          className="group relative overflow-hidden rounded-xl border border-canvas-line bg-canvas-raised"
        >
          <div className="relative aspect-square">
            {item.kind === "video" ? (
              <video src={item.blobUrl} className="h-full w-full object-cover" muted preload="metadata" />
            ) : (
              <Image src={item.blobUrl} alt="" fill sizes="200px" className="object-cover" />
            )}
          </div>
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
            {onApprove && (
              <button
                onClick={() => onApprove(item.id)}
                className="rounded-full bg-volt px-2 py-1 text-[11px] font-medium text-canvas"
              >
                Approve
              </button>
            )}
            {onReject && (
              <button
                onClick={() => onReject(item.id)}
                className="rounded-full bg-white/10 px-2 py-1 text-[11px] text-paper"
              >
                Reject
              </button>
            )}
            <button
              onClick={() => onDelete(item.id)}
              className="ml-auto rounded-full bg-red-500/20 px-2 py-1 text-[11px] text-red-300"
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
