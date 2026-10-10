import { SignJWT, jwtVerify } from "jose";
import { and, asc, count, eq, sql } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import { db } from "./db";
import { env, getAppUrl } from "./env";
import { clientIp, consume } from "./ratelimit";
import { userPasskeys, users } from "./schema";
import { parsePasskeyAnswer } from "./passkey-answers";

/**
 * ACC-6: passkeys. A guest who signed in once with an emailed code signs in
 * the next time with the phone's own lock: Face ID, a fingerprint, the PIN.
 *
 * Built on @simplewebauthn rather than Auth.js's WebAuthn provider, which is
 * experimental and pins a version two majors old. A passkey sign-in ends in
 * the same JWT session as every other way in, through a Credentials provider
 * in lib/auth.ts whose `authorize` calls `verifyPasskeySignIn` below.
 *
 * Every ceremony has a one-time challenge. It travels in a signed, short-lived
 * cookie rather than a table, so opening the sign-in page writes nothing, and
 * it is spent through the rate limiter's atomic counter, so a captured answer
 * cannot be replayed even inside the five minutes the cookie lives.
 */

export const PASSKEY_LIMIT = 10;
export const PASSKEY_CHALLENGE_COOKIE = "klik_passkey";
export const PASSKEY_CHALLENGE_SECONDS = 5 * 60;
const AUDIENCE = "klik:passkey";

export type CeremonyPurpose = "register" | "signin";

/**
 * Where a passkey belongs. A passkey is bound to one domain for good, so this
 * is never read from the request's Host header: only Klik's own address, and
 * localhost while developing, are accepted. A preview deployment refuses
 * rather than minting passkeys that only work on a URL that is about to vanish.
 */
export function relyingPartyFor(requestUrl: string): { id: string; origin: string } | null {
  const origin = new URL(requestUrl).origin;
  const allowed = new Set([new URL(getAppUrl()).origin]);
  if (process.env.NODE_ENV !== "production") allowed.add("http://localhost:3000");
  if (!allowed.has(origin)) return null;
  return { id: new URL(origin).hostname, origin };
}

/** The WebAuthn user handle: the account id's bytes. Stable, and not personal data. */
export function userHandle(userId: string): Uint8Array<ArrayBuffer> {
  return isoUint8Array.fromUTF8String(userId) as Uint8Array<ArrayBuffer>;
}

function secret() {
  return new TextEncoder().encode(env.AUTH_SECRET);
}

type Ceremony = { challenge: string; purpose: CeremonyPurpose; origin: string; userId: string | null };

export async function sealCeremony(ceremony: Ceremony): Promise<string> {
  return new SignJWT({ c: ceremony.challenge, p: ceremony.purpose, o: ceremony.origin, u: ceremony.userId })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${PASSKEY_CHALLENGE_SECONDS}s`)
    .sign(secret());
}

/**
 * Opens a ceremony cookie and spends its challenge. Null for anything forged,
 * expired, for the wrong purpose or address, or already used once.
 */
export async function openCeremony(
  token: string | undefined,
  expected: { purpose: CeremonyPurpose; origin: string },
): Promise<Ceremony | null> {
  if (!token) return null;
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, secret(), { audience: AUDIENCE }));
  } catch {
    return null;
  }
  if (typeof payload.c !== "string" || payload.p !== expected.purpose || payload.o !== expected.origin) return null;
  // Single use. The counter is atomic, so two requests racing with one answer
  // cannot both get past here, and the purge cron sweeps the key later.
  const spent = await consume(`passkey:challenge:${payload.c}`, 1, PASSKEY_CHALLENGE_SECONDS * 2);
  if (!spent.allowed) return null;
  return {
    challenge: payload.c,
    purpose: expected.purpose,
    origin: expected.origin,
    userId: typeof payload.u === "string" ? payload.u : null,
  };
}

export { cookieFrom } from "./request-cookies";
import { cookieFrom } from "./request-cookies";

// --- Naming -------------------------------------------------------------------

/**
 * The password managers that say who they are. Only names that are certain:
 * an unknown AAGUID falls back to the device, and the holder can rename it.
 */
const AUTHENTICATOR_NAMES: Record<string, string> = {
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud Keychain",
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
  "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome on Mac",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
};

/** The device a passkey was made on, from its browser, in words a person uses. */
export function deviceFromUserAgent(userAgent: string | null): string | null {
  if (!userAgent) return null;
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return /Mobile/.test(userAgent) ? "Android phone" : "Android tablet";
  if (/CrOS/.test(userAgent)) return "Chromebook";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows computer";
  if (/Linux/.test(userAgent)) return "Linux computer";
  return null;
}

export function defaultPasskeyName(aaguid: string | null, userAgent: string | null): string {
  return (aaguid ? AUTHENTICATOR_NAMES[aaguid] : undefined) ?? deviceFromUserAgent(userAgent) ?? "Passkey";
}

export function cleanPasskeyName(name: string): string | null {
  const cleaned = name.replace(/\s+/g, " ").trim().slice(0, 60);
  return cleaned.length > 0 ? cleaned : null;
}

// --- Registration ---------------------------------------------------------------

export type PasskeySummary = {
  id: string;
  name: string;
  synced: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

export async function listPasskeys(userId: string): Promise<PasskeySummary[]> {
  const rows = await db
    .select()
    .from(userPasskeys)
    .where(eq(userPasskeys.userId, userId))
    .orderBy(asc(userPasskeys.createdAt));
  return rows.map(summarise);
}

function summarise(row: typeof userPasskeys.$inferSelect): PasskeySummary {
  return {
    id: row.id,
    name: row.name,
    synced: row.deviceType === "multiDevice",
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

export async function registrationOptions(
  account: { id: string; email: string | null; username: string | null; name: string | null },
  rp: { id: string },
) {
  const existing = await db
    .select({ id: userPasskeys.id, transports: userPasskeys.transports })
    .from(userPasskeys)
    .where(eq(userPasskeys.userId, account.id));
  if (existing.length >= PASSKEY_LIMIT) return { full: true as const };

  const label = account.email ?? account.username ?? "Klik account";
  const options = await generateRegistrationOptions({
    rpName: "Klik",
    rpID: rp.id,
    userName: label,
    userDisplayName: account.name?.trim() || label,
    userID: userHandle(account.id),
    // Nothing about the authenticator is needed beyond its key. Asking for an
    // attestation adds a permission prompt on some phones and buys nothing here.
    attestationType: "none",
    // The phone's own passkey, made once: a second one on the same phone would
    // only be a duplicate row.
    excludeCredentials: existing.map((row) => ({ id: row.id, transports: row.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    preferredAuthenticatorType: "localDevice",
  });
  return { full: false as const, options };
}

export type RegisterOutcome =
  | { ok: true; passkey: PasskeySummary }
  | { ok: false; status: number; error: string };

export async function registerPasskey({
  userId,
  response,
  expectedChallenge,
  rp,
  name,
  userAgent,
}: {
  userId: string;
  response: RegistrationResponseJSON;
  expectedChallenge: string;
  rp: { id: string; origin: string };
  name: string | null;
  userAgent: string | null;
}): Promise<RegisterOutcome> {
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
    });
  } catch {
    return { ok: false, status: 400, error: "That passkey could not be checked. Try again." };
  }
  if (!verification.verified) {
    return { ok: false, status: 400, error: "That passkey could not be checked. Try again." };
  }

  const [{ n }] = await db.select({ n: count() }).from(userPasskeys).where(eq(userPasskeys.userId, userId));
  if (n >= PASSKEY_LIMIT) {
    return { ok: false, status: 409, error: `An account can have ${PASSKEY_LIMIT} passkeys. Remove one first.` };
  }

  const { credential, aaguid, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const knownAaguid = aaguid && aaguid !== "00000000-0000-0000-0000-000000000000" ? aaguid : null;
  const [row] = await db
    .insert(userPasskeys)
    .values({
      id: credential.id,
      userId,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? response.response.transports ?? [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      aaguid: knownAaguid,
      name: (name && cleanPasskeyName(name)) ?? defaultPasskeyName(knownAaguid, userAgent),
    })
    .onConflictDoNothing({ target: userPasskeys.id })
    .returning();
  if (!row) {
    // The same credential id already exists: on this account, a double submit;
    // on another, an authenticator that reuses ids, which is not to be trusted.
    return { ok: false, status: 409, error: "This passkey is already saved." };
  }
  return { ok: true, passkey: summarise(row) };
}

// --- Sign-in ----------------------------------------------------------------------

export async function signInOptions(rp: { id: string }) {
  // No list of credentials: the phone offers whichever Klik passkeys it holds,
  // so nobody types an address first and nothing reveals whether one exists.
  return generateAuthenticationOptions({ rpID: rp.id, userVerification: "required" });
}

export type SignInOutcome =
  | { ok: true; userId: string }
  | { ok: false; reason: "unknown" | "invalid" };

/** Checks a sign-in answer against the stored key. Updates the counter and last use. */
export async function verifyPasskeySignIn({
  response,
  expectedChallenge,
  rp,
}: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  rp: { id: string; origin: string };
}): Promise<SignInOutcome> {
  const [stored] = await db.select().from(userPasskeys).where(eq(userPasskeys.id, response.id)).limit(1);
  if (!stored) return { ok: false, reason: "unknown" };

  // A discoverable credential says whose it is. It must be the account the
  // stored key belongs to, or a key is being presented on someone else's behalf.
  const handle = response.response.userHandle;
  if (handle && isoUint8Array.toUTF8String(isoBase64URL.toBuffer(handle)) !== stored.userId) {
    return { ok: false, reason: "invalid" };
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: {
        id: stored.id,
        publicKey: isoBase64URL.toBuffer(stored.publicKey),
        counter: stored.counter,
        transports: stored.transports,
      },
      requireUserVerification: true,
    });
  } catch {
    // Includes a counter that went backwards: a cloned key.
    return { ok: false, reason: "invalid" };
  }
  if (!verification.verified) return { ok: false, reason: "invalid" };

  await db
    .update(userPasskeys)
    .set({
      counter: verification.authenticationInfo.newCounter,
      backedUp: verification.authenticationInfo.credentialBackedUp,
      lastUsedAt: sql`now()`,
    })
    .where(and(eq(userPasskeys.id, stored.id), eq(userPasskeys.userId, stored.userId)));
  return { ok: true, userId: stored.userId };
}

export type PasskeyAuthorization =
  | { ok: true; user: typeof users.$inferSelect }
  | { ok: false; reason: "throttled" | "malformed" | "expired" | "unknown" | "invalid" };

/**
 * The whole of a passkey sign-in, from the raw answer and the request it came
 * in on to the account it opens. lib/auth.ts turns the reasons into the codes
 * the sign-in page reads; nothing here knows about Auth.js.
 */
export async function authorizePasskey(raw: unknown, request: Request): Promise<PasskeyAuthorization> {
  if (typeof raw !== "string" || raw.length > 16_384) return { ok: false, reason: "malformed" };

  const byIp = await consume(`passkey:signin-ip:${clientIp(request)}`, 30, 15 * 60);
  if (!byIp.allowed) return { ok: false, reason: "throttled" };

  const rp = relyingPartyFor(request.url);
  const response = parsePasskeyAnswer(raw);
  if (!rp || !response) return { ok: false, reason: "malformed" };

  const ceremony = await openCeremony(cookieFrom(request.headers.get("cookie"), PASSKEY_CHALLENGE_COOKIE), {
    purpose: "signin",
    origin: rp.origin,
  });
  if (!ceremony) return { ok: false, reason: "expired" };

  const outcome = await verifyPasskeySignIn({ response, expectedChallenge: ceremony.challenge, rp });
  if (!outcome.ok) return outcome;

  const [user] = await db.select().from(users).where(eq(users.id, outcome.userId)).limit(1);
  return user ? { ok: true, user } : { ok: false, reason: "unknown" };
}
