/**
 * Resolves the app's public base URL for QR codes / share links: an explicit
 * APP_URL wins, otherwise fall back to Vercel's own ambient deployment URL so
 * things work correctly before a custom domain (or APP_URL) is configured.
 */
export function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
