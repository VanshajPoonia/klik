import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * AI-5's cloud tier: Replicate over its HTTP API. The low-volume path that a
 * host starts one photo at a time (section C, 2026-09-30), where model quality
 * matters more than cost.
 *
 * Switched on by `REPLICATE_API_TOKEN`. Without it `isReplicateConfigured()`
 * is false and the button never shows.
 *
 * Inputs are sent as a short-lived signed URL to the photo in R2, never as a
 * public link, and Replicate deletes API predictions' files after an hour.
 */

const API = "https://api.replicate.com/v1";

/** Real-ESRGAN, without its face model: see ROADMAP.md section C. */
export const UPSCALE_MODEL = "nightmareai/real-esrgan";

export function isReplicateConfigured(): boolean {
  return Boolean(process.env.REPLICATE_API_TOKEN);
}

export class ReplicateError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ReplicateError";
  }
}

interface Options {
  fetchImpl?: typeof fetch;
}

async function call<T>(path: string, init: RequestInit, options: Options = {}): Promise<T> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new ReplicateError("Replicate is not configured", 0, false);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new ReplicateError(`Replicate unreachable: ${error instanceof Error ? error.message : String(error)}`, 0, true);
  }
  const body = (await response.json().catch(() => null)) as (T & { detail?: string; title?: string }) | null;
  if (!response.ok || !body) {
    const detail = body?.detail ?? body?.title ?? `HTTP ${response.status}`;
    throw new ReplicateError(`Replicate ${path}: ${detail}`, response.status, response.status === 429 || response.status >= 500);
  }
  return body;
}

/**
 * The model's current version, asked for rather than pinned: a community
 * model's old versions can be deleted by its owner, and a pinned id would
 * then fail every run. Kept for an hour. `REPLICATE_UPSCALE_VERSION` pins one
 * if a new version ever misbehaves.
 */
let versionCache: { id: string; at: number } | null = null;

export async function upscaleVersion(options: Options = {}): Promise<string> {
  if (process.env.REPLICATE_UPSCALE_VERSION) return process.env.REPLICATE_UPSCALE_VERSION;
  if (versionCache && Date.now() - versionCache.at < 60 * 60 * 1000) return versionCache.id;
  const model = await call<{ latest_version?: { id?: string } }>(`/models/${UPSCALE_MODEL}`, { method: "GET" }, options);
  const id = model.latest_version?.id;
  if (!id) throw new ReplicateError(`${UPSCALE_MODEL} has no version`, 200, false);
  versionCache = { id, at: Date.now() };
  return id;
}

export interface Prediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: unknown;
  error?: unknown;
}

export async function createUpscale(
  imageUrl: string,
  { scale, webhook }: { scale: number; webhook?: string | null },
  options: Options = {},
): Promise<Prediction> {
  const version = await upscaleVersion(options);
  return call<Prediction>(
    "/predictions",
    {
      method: "POST",
      body: JSON.stringify({
        version,
        input: { image: imageUrl, scale, face_enhance: false },
        ...(webhook ? { webhook, webhook_events_filter: ["completed"] } : {}),
      }),
    },
    options,
  );
}

export function getPrediction(id: string, options: Options = {}): Promise<Prediction> {
  return call<Prediction>(`/predictions/${encodeURIComponent(id)}`, { method: "GET" }, options);
}

export async function cancelPrediction(id: string, options: Options = {}): Promise<void> {
  await call(`/predictions/${encodeURIComponent(id)}/cancel`, { method: "POST" }, options).catch(() => undefined);
}

/** The one URL a finished upscale hands back. Some versions answer with a list. */
export function outputUrl(output: unknown): string | null {
  const value = Array.isArray(output) ? output[0] : output;
  return typeof value === "string" && /^https:\/\//.test(value) ? value : null;
}

let secretCache: string | null = null;

/** The account's webhook signing secret, asked for once per instance. */
export async function webhookSecret(options: Options = {}): Promise<string> {
  if (process.env.REPLICATE_WEBHOOK_SECRET) return process.env.REPLICATE_WEBHOOK_SECRET;
  if (secretCache) return secretCache;
  const { key } = await call<{ key?: string }>("/webhooks/default/secret", { method: "GET" }, options);
  if (!key?.startsWith("whsec_")) throw new ReplicateError("Replicate webhook secret is not the shape expected", 200, false);
  secretCache = key;
  return key;
}

/** Five minutes either way, the Standard Webhooks default. */
const TOLERANCE_SECONDS = 5 * 60;

/**
 * Standard Webhooks, as Replicate signs them: HMAC-SHA256 over
 * `id.timestamp.body` with the base64 secret after `whsec_`, compared in
 * constant time against each `v1,` signature in the header.
 */
export function verifyWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  now = Date.now(),
): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const timestamp = Number(headers.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${body}`).digest();
  return headers.signature.split(" ").some((entry) => {
    const [version, signature] = entry.split(",");
    if (version !== "v1" || !signature) return false;
    const given = Buffer.from(signature, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
