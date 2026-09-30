type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** JSON request that never throws: network failures and bad responses come
 * back as `{ ok: false, error }` so callers can show a message and recover. */
export async function apiRequest<T = Record<string, unknown>>(
  url: string,
  init: { method?: string; body?: unknown } = {},
  fallbackError = "Something went wrong. Try again.",
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: typeof data?.error === "string" ? data.error : fallbackError };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Could not reach Klik. Check your connection and try again." };
  }
}
