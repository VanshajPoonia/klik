"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Heart, MessageCircle, Play } from "lucide-react";

interface Insights {
  galleryOpens: number;
  guestsJoined: number;
  contributors: number;
  photos: number;
  videos: number;
  shareOpens: number;
  timeline: Array<{ bucket: string; uploads: number }>;
  bucketSize: "hour" | "day";
  topContributors: Array<{ name: string; uploads: number }>;
  hearts?: number;
  comments?: number;
  mostLoved?: Array<{ id: string; kind: "photo" | "video"; hearts: number; comments: number }>;
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat();

/** 1,284 under ten thousand, then 12.9K: exact while it fits, compact after. */
function figure(value: number): string {
  return value < 10_000 ? whole.format(value) : compact.format(value);
}

function bucketLabel(iso: string, size: "hour" | "day"): string {
  const date = new Date(iso);
  return size === "hour"
    ? date.toLocaleString(undefined, { weekday: "short", hour: "numeric" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-canvas-line p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-paper">{figure(value)}</p>
    </div>
  );
}

/**
 * GRW-7: what happened at the event, for the organizer. One hero number, the
 * supporting counts as tiles, uploads over time as a single-series column
 * chart, and the guests who shared the most. Every value is also reachable as
 * text: the chart has a table view and each column a focusable tooltip.
 */
export function InsightsPanel({ eventId, slug }: { eventId: string; slug: string }) {
  const [data, setData] = useState<Insights | null>(null);
  const [failed, setFailed] = useState(false);
  const [asTable, setAsTable] = useState(false);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/events/${eventId}/insights`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body: Insights) => !cancelled && setData(body))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (failed) return <p className="text-sm text-muted">Insights could not be loaded. Try again shortly.</p>;
  if (!data) return <p className="text-sm text-muted">Counting…</p>;

  const total = data.photos + data.videos;
  const social = (data.hearts ?? 0) > 0 || (data.comments ?? 0) > 0;
  const max = Math.max(1, ...data.timeline.map((row) => row.uploads));
  const slot = data.timeline.length > 0 ? Math.max(8, Math.min(40, 720 / data.timeline.length)) : 40;
  const barWidth = Math.min(24, slot - 2);
  const chartWidth = Math.max(240, slot * data.timeline.length);
  const chartHeight = 180;
  const top = 12;
  const plotHeight = chartHeight - top - 28;
  const y = (value: number) => top + plotHeight - (value / max) * plotHeight;
  const ticks = [0, Math.ceil(max / 2), max].filter((value, index, all) => all.indexOf(value) === index);
  const labelEvery = Math.max(1, Math.ceil(data.timeline.length / 6));

  return (
    <div className="space-y-8">
      <section className="grid gap-4 md:grid-cols-[1.2fr_2fr]">
        <div className="rounded-2xl border border-canvas-line p-5">
          <p className="text-sm text-muted">Photos and videos shared</p>
          <p className="mt-2 text-5xl font-semibold text-paper">{figure(total)}</p>
          <p className="mt-2 text-xs text-muted">
            {figure(data.photos)} photos, {figure(data.videos)} videos
          </p>
        </div>
        <div className={`grid grid-cols-2 gap-3 ${social ? "sm:grid-cols-3" : "sm:grid-cols-4"}`}>
          <StatTile label="Gallery opens" value={data.galleryOpens} />
          <StatTile label="Guests joined" value={data.guestsJoined} />
          <StatTile label="Guests who shared" value={data.contributors} />
          <StatTile label="Share link opens" value={data.shareOpens} />
          {/* MED-9. Only once there is something to count. */}
          {social && <StatTile label="Hearts" value={data.hearts ?? 0} />}
          {social && <StatTile label="Comments" value={data.comments ?? 0} />}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-paper">
            Uploads by {data.bucketSize === "hour" ? "hour" : "day"}
          </h2>
          {data.timeline.length > 0 && (
            <button
              type="button"
              onClick={() => setAsTable((value) => !value)}
              className="text-xs text-muted underline underline-offset-2 hover:text-paper"
            >
              {asTable ? "Show as chart" : "Show as table"}
            </button>
          )}
        </div>

        {data.timeline.length === 0 ? (
          <p className="rounded-xl border border-dashed border-canvas-line px-4 py-10 text-center text-sm text-muted">
            Uploads appear here as guests share.
          </p>
        ) : asTable ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 font-normal">{data.bucketSize === "hour" ? "Hour" : "Day"}</th>
                <th className="py-1 text-right font-normal">Uploads</th>
              </tr>
            </thead>
            <tbody>
              {data.timeline.map((row) => (
                <tr key={row.bucket} className="border-t border-canvas-line">
                  <td className="py-1.5 text-paper">{bucketLabel(row.bucket, data.bucketSize)}</td>
                  <td className="py-1.5 text-right tabular-nums text-paper">{row.uploads}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="relative overflow-x-auto">
            <svg
              width={chartWidth + 32}
              height={chartHeight}
              viewBox={`0 0 ${chartWidth + 32} ${chartHeight}`}
              role="img"
              aria-label={`Uploads by ${data.bucketSize}, peaking at ${max}`}
              className="block"
            >
              {ticks.map((tick) => (
                <g key={tick}>
                  <line x1={32} x2={chartWidth + 32} y1={y(tick)} y2={y(tick)} stroke="var(--color-canvas-line)" strokeWidth={1} />
                  <text x={26} y={y(tick) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)">
                    {tick}
                  </text>
                </g>
              ))}
              {data.timeline.map((row, index) => {
                const x = 32 + index * slot + (slot - barWidth) / 2;
                const height = Math.max(0, top + plotHeight - y(row.uploads));
                const radius = Math.min(4, height / 2, barWidth / 2);
                const baseline = top + plotHeight;
                const path = height
                  ? `M${x},${baseline} V${baseline - height + radius} Q${x},${baseline - height} ${x + radius},${baseline - height} H${x + barWidth - radius} Q${x + barWidth},${baseline - height} ${x + barWidth},${baseline - height + radius} V${baseline} Z`
                  : "";
                return (
                  <g
                    key={row.bucket}
                    tabIndex={0}
                    role="img"
                    aria-label={`${bucketLabel(row.bucket, data.bucketSize)}: ${row.uploads} uploads`}
                    onPointerEnter={() => setActive(index)}
                    onPointerLeave={() => setActive((current) => (current === index ? null : current))}
                    onFocus={() => setActive(index)}
                    onBlur={() => setActive((current) => (current === index ? null : current))}
                    className="outline-none"
                  >
                    {/* The hit target is the whole column slot, not the bar. */}
                    <rect x={32 + index * slot} y={top} width={slot} height={plotHeight} fill="transparent" />
                    {path && (
                      <path
                        d={path}
                        fill="var(--color-volt)"
                        stroke={active === index ? "var(--color-paper)" : "none"}
                        strokeWidth={2}
                      />
                    )}
                    {index % labelEvery === 0 && (
                      <text x={x + barWidth / 2} y={chartHeight - 8} textAnchor="middle" fontSize={11} fill="var(--color-muted)">
                        {bucketLabel(row.bucket, data.bucketSize)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {active !== null && data.timeline[active] && (
              <div
                className="pointer-events-none absolute top-0 rounded-lg border border-canvas-line bg-canvas px-3 py-2 text-xs shadow-lg"
                style={{ left: Math.min(chartWidth - 80, 32 + active * slot) }}
                role="status"
              >
                <p className="text-sm font-semibold text-paper">{data.timeline[active].uploads} uploads</p>
                <p className="text-muted">{bucketLabel(data.timeline[active].bucket, data.bucketSize)}</p>
              </div>
            )}
          </div>
        )}
      </section>

      {data.mostLoved && data.mostLoved.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-paper">Guests&apos; favourites</h2>
          <ol className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {data.mostLoved.map((item, index) => (
              <li key={item.id} className="relative aspect-square overflow-hidden rounded-xl border border-canvas-line bg-canvas-raised">
                <Image
                  src={`/api/e/${encodeURIComponent(slug)}/media/${encodeURIComponent(item.id)}/content?thumb=1`}
                  alt={`Number ${index + 1}, with ${item.hearts} ${item.hearts === 1 ? "heart" : "hearts"}`}
                  fill
                  unoptimized
                  loading="lazy"
                  sizes="160px"
                  className="object-cover"
                />
                {item.kind === "video" && (
                  <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-paper">
                    <Play className="h-3 w-3" aria-hidden="true" />
                  </span>
                )}
                <span
                  className="absolute bottom-1.5 left-1.5 flex items-center gap-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium tabular-nums text-paper"
                  aria-hidden="true"
                >
                  <span className="flex items-center gap-1">
                    <Heart className="h-3 w-3 fill-volt text-volt" />
                    {item.hearts}
                  </span>
                  {item.comments > 0 && (
                    <span className="flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" />
                      {item.comments}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {data.topContributors.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-paper">Guests who shared the most</h2>
          <ol className="divide-y divide-canvas-line rounded-xl border border-canvas-line">
            {data.topContributors.map((row, index) => (
              <li key={`${row.name}-${index}`} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-paper">{row.name}</span>
                <span className="tabular-nums text-muted">{row.uploads}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
