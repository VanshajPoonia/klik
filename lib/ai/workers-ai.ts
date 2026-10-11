import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  SYSTEM_PROMPT,
  USER_PROMPT,
  VISION_MODEL,
  parseDescription,
  type Description,
} from "../vision";

/**
 * AI-2, AI-6: Cloudflare Workers AI over its REST API. The high-volume,
 * per-photo path (section C, 2026-09-30): the bytes stay in the Cloudflare
 * account that already holds the bucket, and a photo costs a fraction of a
 * cent.
 *
 * Switched on by `CLOUDFLARE_AI_API_TOKEN` alone (a token with Workers AI
 * Read). The account is the one R2 already names, unless
 * `CLOUDFLARE_ACCOUNT_ID` says otherwise. Without the token every caller sees
 * `isVisionConfigured() === false` and nothing is queued, called or shown.
 */

export function visionAccountId(): string | null {
  return process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || null;
}

export function isVisionConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_AI_API_TOKEN && visionAccountId());
}

/** A failure worth trying again later (rate limit, outage), as opposed to a bad request. */
export class WorkersAiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "WorkersAiError";
  }
}

interface RunOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function run(model: string, body: unknown, options: RunOptions = {}): Promise<unknown> {
  const token = process.env.CLOUDFLARE_AI_API_TOKEN;
  const account = visionAccountId();
  if (!token || !account) throw new WorkersAiError("Workers AI is not configured", 0, false);
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
  } catch (error) {
    throw new WorkersAiError(`Workers AI unreachable: ${error instanceof Error ? error.message : String(error)}`, 0, true);
  }
  const json = (await response.json().catch(() => null)) as {
    success?: boolean;
    result?: unknown;
    errors?: Array<{ message?: string; code?: number }>;
  } | null;
  if (!response.ok || !json || json.success === false) {
    const message = json?.errors?.map((error) => error.message).filter(Boolean).join("; ") || `HTTP ${response.status}`;
    // 429 and 5xx come back; 400, 401 and 403 are a request or a token that
    // will be just as wrong next time.
    throw new WorkersAiError(`Workers AI ${model}: ${message}`, response.status, response.status === 429 || response.status >= 500);
  }
  return json.result;
}

/**
 * Meta's models ask for their licence to be accepted once per account, by
 * sending the word "agree". Done here, when the model says so, rather than as
 * a setup step somebody has to remember.
 */
async function withLicence<T>(model: string, attempt: () => Promise<T>, options: RunOptions): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (error instanceof WorkersAiError && /agree|licen[cs]e/i.test(error.message)) {
      await run(model, { prompt: "agree" }, options).catch(() => undefined);
      return attempt();
    }
    throw error;
  }
}

export type DescribeResult = { kind: "described"; description: Description } | { kind: "refused" };

/**
 * One photo, as JPEG bytes, to a caption, labels and the safety answers.
 * Throws a retryable error for an answer it could not read, since a second
 * sampling usually reads fine; a refusal is an answer, not an error.
 */
export async function describePhoto(jpeg: Uint8Array, options: RunOptions = {}): Promise<DescribeResult> {
  const image = `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`;
  const body = {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: USER_PROMPT },
          { type: "image_url", image_url: { url: image } },
        ],
      },
    ],
    max_tokens: 300,
    temperature: 0,
  };
  const result = (await withLicence(VISION_MODEL, () => run(VISION_MODEL, body, options), options)) as {
    response?: unknown;
  } | null;
  const parsed = parseDescription(result?.response);
  if (parsed === "refused") return { kind: "refused" };
  if (!parsed) throw new WorkersAiError("Workers AI answer was not the JSON asked for", 200, true);
  return { kind: "described", description: parsed };
}

/** Text to bge-m3 vectors, up to 100 at a time. */
export async function embedTexts(texts: string[], options: RunOptions = {}): Promise<number[][]> {
  if (texts.length === 0) return [];
  const result = (await run(EMBEDDING_MODEL, { text: texts, truncate_inputs: true }, options)) as {
    data?: unknown;
    response?: unknown;
  } | null;
  const vectors = (Array.isArray(result?.data) ? result.data : result?.response) as unknown;
  if (
    !Array.isArray(vectors) ||
    vectors.length !== texts.length ||
    !vectors.every((vector) => Array.isArray(vector) && vector.length === EMBEDDING_DIMENSIONS && vector.every((n) => typeof n === "number"))
  ) {
    throw new WorkersAiError("Workers AI embeddings were not the shape expected", 200, false);
  }
  return vectors as number[][];
}
