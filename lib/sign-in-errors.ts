/** ACC-2: where the code form leaves the address and destination across a failed attempt. */
export const SIGN_IN_CODE_COOKIE = "klik_signin_code";

/** Reads that cookie back, or null. The destination is still untrusted. */
export function readSignInCodeCookie(value: string | undefined): { email: string; next: string | null } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as { email?: unknown; next?: unknown };
    if (typeof parsed.email !== "string" || !parsed.email.includes("@") || parsed.email.length > 254) return null;
    return { email: parsed.email, next: typeof parsed.next === "string" ? parsed.next : null };
  } catch {
    return null;
  }
}

/** Messages for the `?error=` Auth.js and the code limiter send back here. */
const ERRORS: Record<string, string> = {
  Verification: "That code did not work, or it has expired. Ask for a new one.",
  TooManyAttempts: "Too many tries. Wait a few minutes, then ask for a new code.",
  OAuthAccountNotLinked: "That email already has a Klik account. Sign in the way you first did, or with an email code.",
  AccessDenied: "That account cannot sign in here.",
  Configuration: "Sign-in is not working right now. Try again, or call us.",
  EmailSignin: "We could not send the code. Check the address and try again.",
};

export function describeSignInError(code: string | null | undefined): string | null {
  if (!code) return null;
  return ERRORS[code] ?? "Could not sign you in. Try again.";
}
