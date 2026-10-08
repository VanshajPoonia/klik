/**
 * The Postgres SQLSTATE behind a failed query, or null.
 *
 * Drizzle 0.45 wraps every query failure in a DrizzleQueryError whose own
 * `code` is undefined; the driver's error, which carries the code, is its
 * `cause`. Checking `error.code` directly therefore never matched, and every
 * "somebody else got there first" branch written that way was dead code that
 * let a unique violation surface as a 500. This walks the cause chain, so it
 * works on a wrapped error, a bare driver error, and a batch's.
 */
export function pgErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === UNIQUE_VIOLATION;
}

/**
 * Whether a failed query was refused with `name`, the message a trigger in
 * drizzle/ raises. The same unwrapping as `pgErrorCode`: the wrapper's message
 * is the failed SQL, and the trigger's words are only on the cause.
 */
export function raisedBy(error: unknown, name: string): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof Error && current.message.includes(name)) {
      // The wrapper's message is the SQL text, which can name a trigger
      // function without that function having raised anything.
      if (!current.message.startsWith("Failed query:")) return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
