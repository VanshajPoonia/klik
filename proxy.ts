import { NextResponse, type NextRequest } from "next/server";

/**
 * VEN-3: requests that arrive on a venue's own domain.
 *
 * Klik's own host, previews and local development pass straight through
 * without a database call, which is every request today. A host that is an
 * active custom domain serves the guest side only: `/` becomes the venue hub
 * (which sends guests on to the featured live gallery, on the same host),
 * galleries and share links are served as they are, and anything else is
 * sent to Klik's own domain, where sign-in and the dashboard live. An unknown
 * host is left alone for Vercel and Next to answer as they always have.
 */
export async function proxy(request: NextRequest) {
  return renewGuestPasses(request, await route(request));
}

async function route(request: NextRequest): Promise<NextResponse> {
  const host = (request.headers.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  const appUrl = process.env.APP_URL;
  const appHost = appUrl ? new URL(appUrl).hostname : null;
  if (!host || host === appHost || host.endsWith(".vercel.app") || host === "localhost" || host === "127.0.0.1") {
    return NextResponse.next();
  }

  const { venueForHost, isGuestPath } = await import("./lib/custom-domains");
  const venueSlug = await venueForHost(host).catch(() => null);
  if (!venueSlug) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (pathname === "/") {
    return NextResponse.rewrite(new URL(`/v/${encodeURIComponent(venueSlug)}`, request.url));
  }
  if (isGuestPath(pathname)) return NextResponse.next();
  if (!appUrl) return NextResponse.next();
  return NextResponse.redirect(new URL(`${pathname}${search}`, appUrl), 308);
}

/**
 * Every gallery a guest joined, and every password-protected one they
 * unlocked, stays that way for a year from their last visit: opening any page
 * renews the pass (`renewGuestPass` in `lib/guest.ts`). Page loads only, and
 * each pass at most once a day, so the gallery's own polling and API calls
 * cost nothing, and a visit that holds no passes never loads the code.
 */
async function renewGuestPasses(request: NextRequest, response: NextResponse): Promise<NextResponse> {
  if (request.method !== "GET" || request.nextUrl.pathname.startsWith("/api/")) return response;
  if (!(request.headers.get("accept") ?? "").includes("text/html")) return response;
  const passes = request.cookies.getAll().filter(({ name }) => name.startsWith("klik_g_") || name.startsWith("klik_unlock_"));
  if (passes.length === 0) return response;
  const { renewGuestPass, guestCookieOptions } = await import("./lib/guest");
  for (const { name, value } of passes) {
    const renewed = await renewGuestPass(value);
    if (renewed) response.cookies.set(name, renewed, guestCookieOptions());
  }
  return response;
}

export const config = {
  // Static build files never need a host check.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
