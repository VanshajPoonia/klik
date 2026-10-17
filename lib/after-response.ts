import { after } from "next/server";

/**
 * Keeps a send running after the response has gone.
 *
 * Vercel freezes a function as soon as it has answered, so a promise left
 * floating is usually cut off rather than occasionally: the test error sent
 * from /admin on 2026-10-17 reached the log but neither Sentry nor the alert
 * email. `after` asks the host to wait for the task. Outside a request, where
 * `after` throws, the task is already running and simply floats, which is
 * fine anywhere the process outlives the request.
 *
 * Server only, so `lib/sentry.ts`, which the browser also loads, takes this
 * as an option instead of importing it.
 */
export function keepAlive(task: Promise<unknown>): void {
  try {
    after(task);
  } catch {
    // No request scope to extend.
  }
}
