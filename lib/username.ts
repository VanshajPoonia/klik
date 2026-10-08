/**
 * ID-1: what a username may be.
 *
 * Usernames are how one organizer finds another (the co-host picker, ID-3) and
 * how a venue login is typed, so they are short, lowercase and unambiguous.
 * Pure, so the rules are tested without a database; the uniqueness half lives
 * in `drizzle/0027_usernames.sql`, as a unique index on `lower(username)` and a
 * trigger that refuses a handle someone else has parked.
 *
 * Handles made before these rules (`daniel.ab12`, from signup and the admin
 * quick-create) still sign in. The rules apply when a handle is chosen.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
/** How long a changed handle is parked, and how often a handle may change. */
export const USERNAME_CHANGE_DAYS = 30;

const SHAPE = /^[a-z][a-z0-9_]*$/;

/**
 * Every top-level route, so no profile URL can ever shadow one, plus the names
 * somebody would pick to look official.
 */
export const RESERVED_USERNAMES = new Set([
  // Routes, current and plausible.
  "about", "account", "admin", "api", "app", "auth", "billing", "blog", "checkout", "contact",
  "dashboard", "docs", "download", "e", "events", "explore", "faq", "features", "help", "home",
  "invite", "invites", "join", "legal", "login", "logout", "me", "new", "onboarding", "pricing",
  "privacy", "s", "search", "security", "settings", "signin", "signup", "status", "support",
  "terms", "u", "upload", "user", "users", "v", "venue", "venues", "www",
  // Looking official.
  "klik", "klikapp", "klik_app", "klik_support", "klik_team", "kreativvantage", "official",
  "staff", "team", "moderator", "mod", "administrator", "root", "system", "sysadmin", "owner",
  "null", "undefined", "anonymous", "guest", "everyone", "nobody", "abuse", "postmaster",
  "hostmaster", "webmaster", "noreply", "no_reply", "info", "mail", "email",
]);

export type UsernameCheck = { ok: true; username: string } | { ok: false; reason: string };

/** Lowercases, strips one leading "@", and says what is wrong if anything is. */
export function validateUsername(raw: string): UsernameCheck {
  const username = raw.trim().replace(/^@/, "").toLowerCase();
  if (username.length < USERNAME_MIN) {
    return { ok: false, reason: `At least ${USERNAME_MIN} characters.` };
  }
  if (username.length > USERNAME_MAX) {
    return { ok: false, reason: `At most ${USERNAME_MAX} characters.` };
  }
  if (!/^[a-z]/.test(username)) return { ok: false, reason: "Start with a letter." };
  if (!SHAPE.test(username)) {
    return { ok: false, reason: "Letters, numbers and underscores only." };
  }
  if (username.includes("__") || username.endsWith("_")) {
    return { ok: false, reason: "No double or trailing underscores." };
  }
  if (RESERVED_USERNAMES.has(username)) return { ok: false, reason: "That one is reserved." };
  return { ok: true, username };
}

/** A handle-shaped stem from a name or an email's local part, or "". */
export function usernameStem(seed: string, max = USERNAME_MAX): string {
  const stem = seed
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+/g, "_")
    .slice(0, max)
    .replace(/_+$/, "");
  return stem;
}

/**
 * A few handles worth offering, from what the account already says about
 * itself. Valid by construction; whether they are free is the caller's query.
 */
export function suggestUsernames(name: string | null, email: string | null): string[] {
  const local = email?.split("@")[0] ?? "";
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const candidates = [
    usernameStem(words.join("_")),
    usernameStem(words.join("")),
    words.length > 1 ? usernameStem(`${words[0]}_${words[words.length - 1][0]}`) : "",
    usernameStem(local),
    usernameStem(words[0] ?? ""),
  ];
  const valid = new Set<string>();
  for (const candidate of candidates) {
    const check = validateUsername(candidate);
    if (check.ok) valid.add(check.username);
  }
  return [...valid];
}

/** Escapes LIKE's wildcards, of which `_` is one and is also a handle character. */
export function likePrefix(value: string): string {
  return `${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
