import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { SignJWT, importJWK, type JWK } from "jose";
import { db } from "./db";
import { providerSecrets } from "./schema";
import { open, seal } from "./sealed";
import { getAppUrl } from "./env";
import { log } from "./observability";

/**
 * OPS-1: Cloudflare Stream, for video playback that does not download a
 * 200 MB original to every phone. Section C (2026-09-30): Stream rather than
 * ffmpeg in a function, whose time and memory are the wrong shape for a 4K
 * clip. The original stays in R2 for download and export.
 *
 * Switched on by `CLOUDFLARE_STREAM_API_TOKEN` (Account, Stream, Edit). Klik
 * makes the rest itself the first time it needs them: a signing key, so
 * playback tokens are signed here without an API call per view, and in
 * production the account's webhook. Both are sealed in `provider_secrets`
 * (lib/sealed.ts), so there is one variable to set and nothing to copy.
 *
 * Every Stream copy requires a signed URL, so a video's uid alone plays
 * nothing; Klik signs one only after the content route's own access check.
 */

const API = "https://api.cloudflare.com/client/v4/accounts";

function accountId(): string | null {
  return process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || null;
}

export function isStreamConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_STREAM_API_TOKEN && accountId());
}

export class StreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "StreamError";
  }
}

interface Options {
  fetchImpl?: typeof fetch;
}

async function call<T>(path: string, init: RequestInit, options: Options = {}): Promise<T> {
  const token = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  const account = accountId();
  if (!token || !account) throw new StreamError("Stream is not configured", 0, false);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(`${API}/${account}/stream${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new StreamError(`Stream unreachable: ${error instanceof Error ? error.message : String(error)}`, 0, true);
  }
  const body = (await response.json().catch(() => null)) as {
    success?: boolean;
    result?: T;
    errors?: Array<{ message?: string }>;
  } | null;
  if (!response.ok || !body || body.success === false) {
    const message = body?.errors?.map((error) => error.message).filter(Boolean).join("; ") || `HTTP ${response.status}`;
    throw new StreamError(`Stream ${path}: ${message}`, response.status, response.status === 429 || response.status >= 500);
  }
  return body.result as T;
}

/* ------------------------------------------------------------ secrets --- */

async function readSecret<T>(name: string): Promise<T | null> {
  const [row] = await db.select().from(providerSecrets).where(eq(providerSecrets.name, name)).limit(1);
  const plain = row ? open(row.sealed) : null;
  if (!plain) return null;
  try {
    return JSON.parse(plain) as T;
  } catch {
    return null;
  }
}

async function writeSecret(name: string, value: unknown) {
  const sealed = seal(JSON.stringify(value));
  await db
    .insert(providerSecrets)
    .values({ name, sealed })
    .onConflictDoUpdate({ target: providerSecrets.name, set: { sealed, updatedAt: new Date() } });
}

interface SigningKey {
  id: string;
  jwk: JWK;
}

let signingKey: { value: SigningKey; key: CryptoKey | Uint8Array } | null = null;

/**
 * The key playback tokens are signed with, made at Stream on first use. A
 * sealed key that no longer opens (AUTH_SECRET rotated) is replaced the same
 * way, and the old one at Stream simply stops being used.
 */
export async function streamSigningKey(options: Options = {}): Promise<{ id: string; key: CryptoKey | Uint8Array }> {
  if (signingKey) return { id: signingKey.value.id, key: signingKey.key };
  let value = await readSecret<SigningKey>("stream.signing_key");
  if (!value) {
    const created = await call<{ id: string; jwk: string }>("/keys", { method: "POST", body: "{}" }, options);
    value = { id: created.id, jwk: JSON.parse(Buffer.from(created.jwk, "base64").toString("utf8")) as JWK };
    await writeSecret("stream.signing_key", value);
    log.info("stream.signing_key_created", { keyId: created.id });
  }
  const key = await importJWK(value.jwk, "RS256");
  signingKey = { value, key };
  return { id: value.id, key };
}

/** Where Stream tells Klik a video is ready. Production only: previews sit behind Vercel's protection. */
export function streamWebhookUrl(): string | null {
  if (process.env.VERCEL_ENV !== "production") return null;
  return `${getAppUrl()}/api/webhooks/stream`;
}

let webhookChecked: string | null = null;

/** Points the account's webhook here once, and keeps its secret sealed. */
export async function ensureStreamWebhook(options: Options = {}): Promise<void> {
  const url = streamWebhookUrl();
  if (!url || webhookChecked === url) return;
  const stored = await readSecret<{ url: string; secret: string }>("stream.webhook");
  if (stored?.url !== url) {
    const result = await call<{ notificationUrl: string; secret: string }>(
      "/webhook",
      { method: "PUT", body: JSON.stringify({ notificationUrl: url }) },
      options,
    );
    await writeSecret("stream.webhook", { url, secret: result.secret });
  }
  webhookChecked = url;
}

export async function streamWebhookSecret(): Promise<string | null> {
  return (await readSecret<{ url: string; secret: string }>("stream.webhook"))?.secret ?? null;
}

/** Stream's `Webhook-Signature: time=<unix>,sig1=<hex>` over `time.body`. */
export function verifyStreamWebhook(secret: string, header: string | null, body: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=", 2) as [string, string]));
  const time = Number(parts.time);
  if (!Number.isFinite(time) || !parts.sig1 || Math.abs(now / 1000 - time) > 5 * 60) return false;
  const expected = createHmac("sha256", secret).update(`${parts.time}.${body}`).digest();
  const given = Buffer.from(parts.sig1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/* ------------------------------------------------------------- videos --- */

export interface StreamVideo {
  uid: string;
  readyToStream: boolean;
  state: string;
  errorReasonCode: string | null;
  hls: string | null;
}

function toVideo(result: {
  uid: string;
  readyToStream?: boolean;
  status?: { state?: string; errorReasonCode?: string; errReasonCode?: string };
  playback?: { hls?: string };
}): StreamVideo {
  return {
    uid: result.uid,
    readyToStream: Boolean(result.readyToStream),
    state: result.status?.state ?? "unknown",
    errorReasonCode: result.status?.errorReasonCode || result.status?.errReasonCode || null,
    hls: result.playback?.hls ?? null,
  };
}

/** Asks Stream to fetch the video from a signed R2 URL. Signed playback only. */
export async function copyToStream(
  url: string,
  meta: { mediaId: string; eventId: string },
  options: Options = {},
): Promise<StreamVideo> {
  const result = await call<Parameters<typeof toVideo>[0]>(
    "/copy",
    {
      method: "POST",
      body: JSON.stringify({ url, meta: { name: meta.mediaId, eventId: meta.eventId }, requireSignedURLs: true }),
    },
    options,
  );
  return toVideo(result);
}

export async function getStreamVideo(uid: string, options: Options = {}): Promise<StreamVideo> {
  return toVideo(await call(`/${encodeURIComponent(uid)}`, { method: "GET" }, options));
}

/** Deletes one copy. A copy already gone is done. */
export async function deleteStreamVideo(uid: string, options: Options = {}): Promise<void> {
  try {
    await call(`/${encodeURIComponent(uid)}`, { method: "DELETE" }, options);
  } catch (error) {
    if (error instanceof StreamError && error.status === 404) return;
    throw error;
  }
}

/** The account's playback host, read off any ready video's HLS address. */
export function customerHost(hls: string | null): string | null {
  if (!hls) return null;
  try {
    const url = new URL(hls);
    return /^customer-[a-z0-9]+\.cloudflarestream\.com$/.test(url.hostname) ? url.hostname : null;
  } catch {
    return null;
  }
}

export async function rememberCustomerHost(host: string): Promise<void> {
  if ((await readSecret<{ host: string }>("stream.customer_host"))?.host !== host) {
    await writeSecret("stream.customer_host", { host });
  }
}

let hostCache: string | null = null;

async function playbackHost(): Promise<string | null> {
  if (hostCache) return hostCache;
  hostCache = (await readSecret<{ host: string }>("stream.customer_host"))?.host ?? null;
  return hostCache;
}

/** An hour covers a three-minute clip, pauses and all, and is far under Stream's 24-hour cap. */
export const PLAYBACK_TOKEN_SECONDS = 60 * 60;

/** The HLS manifest for one video, behind a token this server signed. Null if it cannot be made. */
export async function signedManifestUrl(uid: string, now = Date.now()): Promise<string | null> {
  const host = await playbackHost();
  if (!host) return null;
  const { id, key } = await streamSigningKey();
  const seconds = Math.floor(now / 1000);
  const token = await new SignJWT({ sub: uid, kid: id })
    .setProtectedHeader({ alg: "RS256", kid: id })
    .setNotBefore(seconds - 60)
    .setExpirationTime(seconds + PLAYBACK_TOKEN_SECONDS)
    .sign(key);
  return `https://${host}/${token}/manifest/video.m3u8`;
}

/** Whether a video plays from its Stream copy. */
export function playsFromStream(row: { streamUid: string | null; streamState: string | null }): boolean {
  return Boolean(row.streamUid) && row.streamState === "ready";
}
