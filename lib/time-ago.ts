/**
 * How long ago something happened, as a comment thread says it: "now", "5m",
 * "3h", "2d", then the date. Pure, so it renders the same on the server and the
 * phone given the same `now`.
 */
export function timeAgo(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const sameYear = new Date(then).getUTCFullYear() === new Date(now).getUTCFullYear();
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(new Date(then));
}
