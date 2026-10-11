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

export const config = {
  // Static build files never need a host check.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
