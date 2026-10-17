import { SignJWT, decodeJwt, jwtVerify } from "jose";
import { env } from "./env";
import { COOKIE_DAYS } from "./legal";

/**
 * How long joining a gallery lasts, and unlocking a password-protected one:
 * a year from the guest's last visit. Each visit renews it (`renewGuestPass`,
 * called by `proxy.ts`), so a guest who opens the gallery from their home
 * screen now and then is never asked to join again. It was 30 days from
 * joining, which is how a guest coming back after a month met the entry sheet.
 */
export const GUEST_PASS_DAYS = COOKIE_DAYS;

/** Renewed at most once a day, so a gallery's every request does not sign a token. */
const RENEW_AFTER_SECONDS = 24 * 60 * 60;

/** The one set of options every guest and unlock cookie is written with. */
export function guestCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_PASS_DAYS * 24 * 60 * 60,
  };
}

export interface GuestSession {
  guestId: string;
  eventId: string;
  /** VEN-2: this device is a kiosk. Checked against `kiosks` on every use. */
  kioskId?: string;
}

// Validated at boot by lib/env.ts, so this no longer throws on the first guest
// session of a misconfigured deploy.
function secret() {
  return new TextEncoder().encode(env.AUTH_SECRET);
}

export function guestCookieName(eventId: string) {
  return `klik_g_${eventId}`;
}

export async function signGuestSession(payload: GuestSession): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${GUEST_PASS_DAYS}d`)
    .sign(secret());
}

/**
 * A guest or unlock cookie re-signed with a fresh year, or null when it does
 * not need it (signed in the last day) or is not one of ours. The same claims
 * go back in, so a renewal can never grant anything the old token did not.
 */
export async function renewGuestPass(token: string, now = Date.now()): Promise<string | null> {
  try {
    const issued = decodeJwt(token).iat;
    if (typeof issued === "number" && now / 1000 - issued < RENEW_AFTER_SECONDS) return null;
    const { payload } = await jwtVerify(token, secret());
    const { iat, exp, ...claims } = payload;
    void iat;
    void exp;
    return await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(Math.floor(now / 1000) + GUEST_PASS_DAYS * 24 * 60 * 60)
      .sign(secret());
  } catch {
    return null;
  }
}

export async function verifyGuestSession(token: string): Promise<GuestSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.guestId !== "string" || typeof payload.eventId !== "string") {
      return null;
    }
    return {
      guestId: payload.guestId,
      eventId: payload.eventId,
      ...(typeof payload.kioskId === "string" ? { kioskId: payload.kioskId } : {}),
    };
  } catch {
    return null;
  }
}

const EVENT_UNLOCK_COOKIE_PREFIX = "klik_unlock_";

export function eventUnlockCookieName(eventId: string) {
  return `${EVENT_UNLOCK_COOKIE_PREFIX}${eventId}`;
}

export async function signEventUnlock(eventId: string, accessVersion: number): Promise<string> {
  return new SignJWT({ eventId, accessVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${GUEST_PASS_DAYS}d`)
    .sign(secret());
}

export async function verifyEventUnlock(
  token: string,
  eventId: string,
  accessVersion: number,
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload.eventId === eventId && payload.accessVersion === accessVersion;
  } catch {
    return false;
  }
}

/**
 * Per-share viewer state: whether this browser has entered the link's password,
 * and whether it has already been counted against the view cap.
 *
 * One cookie holds both because they belong to the same viewer and the same
 * link, and because two cookies per share would double an already unbounded
 * count: someone who opens twenty share links collects twenty of these. That is
 * also why the lifetime is 7 days rather than the 30 used for a gallery session.
 * A share link is a one-off; a gallery is somewhere you come back to.
 *
 * Keyed by share id rather than by token, so the token itself never lands in the
 * cookie jar.
 */
export interface ShareViewerState {
  shareId: string;
  unlocked: boolean;
  counted: boolean;
}

export const SHARE_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

export function shareCookieName(shareId: string) {
  return `klik_s_${shareId}`;
}

export async function signShareViewer(state: ShareViewerState): Promise<string> {
  return new SignJWT({ ...state })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

/**
 * Returns the state for this share, or null. The `shareId` comparison is the
 * point: without it a cookie minted for one share would be accepted for
 * another, and since the cookie carries the unlocked flag that would turn one
 * known password into access to every password-protected link on the site.
 */
export async function verifyShareViewer(
  token: string,
  shareId: string,
): Promise<ShareViewerState | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.shareId !== shareId) return null;
    return {
      shareId,
      unlocked: payload.unlocked === true,
      counted: payload.counted === true,
    };
  } catch {
    return null;
  }
}
