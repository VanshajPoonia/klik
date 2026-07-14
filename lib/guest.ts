import { SignJWT, jwtVerify } from "jose";

export interface GuestSession {
  guestId: string;
  eventId: string;
}

function secret() {
  if (!process.env.AUTH_SECRET) {
    throw new Error("AUTH_SECRET is not set");
  }
  return new TextEncoder().encode(process.env.AUTH_SECRET);
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

export async function signEventUnlock(eventId: string): Promise<string> {
  return new SignJWT({ eventId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function verifyEventUnlock(token: string, eventId: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload.eventId === eventId;
  } catch {
    return false;
  }
}
