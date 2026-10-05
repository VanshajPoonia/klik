/**
 * Narrows an untrusted `?next=` value to a path inside Klik, or null.
 *
 * Sign-in carries this across a redirect, which is exactly the shape of an open
 * redirect: a link to `klik.../login?next=https://evil.example` that signs
 * someone in and then lands them somewhere else, wearing our domain in the
 * address bar on the way. Anything that is not plainly one of our own paths is
 * dropped and the caller falls back to its default.
 */
export function safeInternalPath(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) return null;

  // Rooted, and single-slashed. "//evil.example" is a protocol-relative URL that
  // browsers leave the site for, and a backslash is the same attack in a hat,
  // since several browsers normalise "\" to "/" before resolving.
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (value.includes("\\")) return null;

  // Control characters, including the tab/newline that browsers strip out of a
  // URL before parsing it, which is how "/\tj\tavascript:..." survives a naive
  // check and then runs.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;

  // Resolving against a throwaway origin catches the encodings the prefix checks
  // do not. Anything that lands off that origin was never ours.
  let resolved: URL;
  try {
    resolved = new URL(value, "https://klik.invalid");
  } catch {
    return null;
  }
  if (resolved.origin !== "https://klik.invalid") return null;

  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
