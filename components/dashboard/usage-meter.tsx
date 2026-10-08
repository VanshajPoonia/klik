import { formatFileSize } from "@/lib/plans";

export interface UsageSummary {
  bytes: number;
  storageLimit: number;
  storagePercent: number;
  count: number;
  photoHeadline: number;
  level: 0 | 75 | 90 | 100;
  uploadDaysLeft: number | null;
}

/**
 * PAY-7: how full the event is and how long uploads stay open, on the event
 * page where the organizer already is.
 *
 * Quiet until it matters: the bar is the brand accent below 75 percent, warns
 * at 75, warns harder at 90 and says "full" at 100. Never a red bar at 60;
 * false urgency teaches people to ignore the meter on the day it is real.
 */
export function UsageMeter({ usage }: { usage: UsageSummary }) {
  const tone =
    usage.level === 100
      ? { bar: "bg-red-500", text: "text-red-400", label: "Full: guests cannot add more" }
      : usage.level === 90
        ? { bar: "bg-amber-500", text: "text-amber-400", label: "Nearly full" }
        : usage.level === 75
          ? { bar: "bg-amber-400", text: "text-amber-300", label: "Filling up" }
          : { bar: "bg-volt", text: "text-muted", label: null };

  return (
    <section aria-label="Storage and upload window" className="mb-8 grid gap-4 rounded-2xl border border-canvas-line p-4 sm:grid-cols-3">
      <div className="sm:col-span-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-paper">
            {formatFileSize(usage.bytes)} <span className="text-muted">of {formatFileSize(usage.storageLimit)}</span>
          </p>
          {tone.label && <p className={`text-xs font-medium ${tone.text}`}>{tone.label}</p>}
        </div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas-line"
          role="meter"
          aria-label="Storage used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={usage.storagePercent}
        >
          <div className={`h-full ${tone.bar}`} style={{ width: `${Math.max(1, usage.storagePercent)}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted">
          {usage.count.toLocaleString()} photos and videos
          {usage.count > usage.photoHeadline
            ? `, past the ${usage.photoHeadline.toLocaleString()} this plan is sized for. Fine, until the storage is used.`
            : `, room for about ${usage.photoHeadline.toLocaleString()}`}
        </p>
      </div>
      <div className="sm:text-right">
        <p className="text-sm text-paper">
          {usage.uploadDaysLeft === null
            ? "Uploads open when live"
            : usage.uploadDaysLeft === 0
              ? "Uploads closed"
              : `${usage.uploadDaysLeft} ${usage.uploadDaysLeft === 1 ? "day" : "days"} of uploads left`}
        </p>
        <p className="mt-1 text-xs text-muted">Guests can still view after uploads close</p>
      </div>
    </section>
  );
}
