import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowUpRight, Globe, Lock } from "lucide-react";
import { formatEventDay, profileFor } from "@/lib/profiles";

type Params = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const profile = await profileFor((await params).username);
  if (!profile || profile.kind !== "profile") return { robots: { index: false } };
  const title = profile.name ? `${profile.name} (@${profile.username})` : `@${profile.username}`;
  return {
    title,
    description: profile.bio ?? `${title} on Klik.`,
    // Indexed only once it lists something, so an empty profile is not a page
    // anyone can use to put a link in front of a search engine.
    robots: { index: profile.events.length > 0 },
  };
}

/**
 * GRW-4: someone's public page. Their words, their link, and the events they
 * chose to list, by name and date. No photos: see lib/profiles.ts.
 */
export default async function ProfilePage({ params }: Params) {
  const profile = await profileFor((await params).username);
  if (!profile) notFound();
  // Temporary on purpose: the old handle is only parked for 30 days, and a
  // cached permanent redirect would outlive that and misdirect people once
  // somebody else takes it.
  if (profile.kind === "moved") redirect(`/u/${profile.username}`);

  const initial = (profile.name ?? profile.username).trim().charAt(0).toUpperCase();
  const websiteHost = profile.website ? new URL(profile.website).hostname.replace(/^www\./, "") : null;

  return (
    <div className="min-h-screen px-4 py-10 sm:px-6 md:px-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-12">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <Image src="/klik-mark.png" alt="" width={28} height={28} className="rounded-[7px]" />
            <span className="text-base font-semibold tracking-tight text-paper">klik</span>
          </Link>
        </header>

        <section className="flex items-start gap-4">
          <span
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-volt font-display text-2xl text-on-volt"
            aria-hidden="true"
          >
            {initial}
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-3xl leading-tight text-paper">{profile.name ?? `@${profile.username}`}</h1>
            {profile.name && <p className="mt-1 text-sm text-muted">@{profile.username}</p>}
            {profile.bio && <p className="mt-4 max-w-lg whitespace-pre-line text-sm leading-relaxed text-paper/85">{profile.bio}</p>}
            {profile.website && websiteHost && (
              <a
                href={profile.website}
                rel="me nofollow noopener ugc"
                target="_blank"
                className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-volt hover:underline"
              >
                <Globe className="h-4 w-4" aria-hidden="true" />
                {websiteHost}
              </a>
            )}
          </div>
        </section>

        <section className="mt-12" aria-labelledby="profile-events">
          <h2 id="profile-events" className="mb-4 text-xs font-medium tracking-wide text-muted uppercase">
            Galleries
          </h2>
          {profile.events.length === 0 ? (
            <p className="rounded-2xl border border-canvas-line bg-canvas-raised px-5 py-6 text-sm text-muted">
              Nothing listed yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {profile.events.map((event) => (
                <li key={event.slug}>
                  <Link
                    href={`/e/${event.slug}`}
                    className="group flex min-h-16 items-center justify-between gap-4 rounded-2xl border border-canvas-line bg-canvas-raised px-5 py-4 transition-colors hover:border-paper/30"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-paper">{event.name}</span>
                      <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                        {event.eventDate ? formatEventDay(event.eventDate) : "Open gallery"}
                        {event.needsPassword && (
                          <span className="inline-flex items-center gap-1">
                            <Lock className="h-3 w-3" aria-hidden="true" />
                            Password needed
                          </span>
                        )}
                      </span>
                    </span>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-muted transition-colors group-hover:text-paper" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="mt-16 text-xs text-muted">
          One QR code, every guest&apos;s photos in one gallery.{" "}
          <Link href="/" className="text-paper hover:underline">
            Made with Klik
          </Link>
        </footer>
      </div>
    </div>
  );
}
