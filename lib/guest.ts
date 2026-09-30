import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";

export interface GuestSession {
  guestId: string;
  eventId: string;
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
    .setExpirationTime("30d")
    .sign(secret());
}

export async function verifyGuestSession(token: string): Promise<GuestSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.guestId !== "string" || typeof payload.eventId !== "string") {
      return null;
    }
    return { guestId: payload.guestId, eventId: payload.eventId };
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
    .setExpirationTime("30d")
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
