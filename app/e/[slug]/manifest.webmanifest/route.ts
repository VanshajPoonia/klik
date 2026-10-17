import { NextResponse } from "next/server";
import { findEventBySlug } from "@/lib/slugs";
import { FROM_HOME_SCREEN, homeScreenLabel } from "@/lib/home-screen";

/**
 * What a phone puts on its home screen for one gallery: its name, Klik's
 * icon, and where the icon goes. `display: "browser"` keeps it a shortcut
 * into the phone's own browser, where the guest is already joined and their
 * waiting uploads are (lib/home-screen.ts says why).
 *
 * Only the name is in it, which the gallery's own page title already shows to
 * anyone with the address, so it carries nothing the link does not.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = (await findEventBySlug(slug))?.event;
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const path = `/e/${event.slug}`;
  return NextResponse.json(
    {
      // Its own entry per gallery, so two events are two icons, not one replaced.
      id: path,
      name: event.name,
      short_name: homeScreenLabel(event.name),
      start_url: `${path}?from=${FROM_HOME_SCREEN}`,
      scope: path,
      display: "browser",
      background_color: "#050505",
      theme_color: "#050505",
      icons: [
        { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
      ],
    },
    {
      headers: {
        "Content-Type": "application/manifest+json",
        // A renamed gallery shows its new name on the next icon within minutes.
        "Cache-Control": "private, max-age=300",
      },
    },
  );
}
