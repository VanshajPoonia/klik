import type { Metadata } from "next";
import Link from "next/link";
import {
  DENIAL_COPY,
  shareContentPath,
  shareDownloadFilename,
  shareDownloadPath,
} from "@/lib/share-access";
import { extensionForMime } from "@/lib/storage";
import { resolveShareRequest } from "@/lib/share-request";
import { ShareView } from "@/components/share/share-view";
import { SharePasswordGate } from "@/components/share/share-password-gate";

/**
 * One photo, reachable by token alone.
 *
 * Deliberately not a gallery. Somebody arriving here was sent one picture by
 * one person, and very likely has never heard of Klik. So the page is the photo,
 * a line saying where it came from, and one way out.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;

  /**
   * The same gate the page body uses, cookie and all, so the tab title cannot
   * contradict what is on screen. It said "this link has been opened too many
   * times" above a perfectly visible photo until this went through the gate
   * instead of around it.
   *
   * A crawler carries no cookie, so it still gets the locked-out view, and that
   * now falls out of the rule rather than being a second hand-written copy of
   * it. Which is the whole reason a password-protected link previews as a locked
   * message with no image: the photo must not appear as a thumbnail to a group
   * chat when the password is what was meant to limit who sees it.
   */
  const resolved = await resolveShareRequest(token);

  // Never indexed, in any state. A share link that turns up in a search result
  // has stopped being a share link.
  const robots = { index: false, follow: false };

  if (!resolved.ok) {
    const copy = DENIAL_COPY[resolved.reason];
    return {
      title: copy.title,
      description: copy.detail,
      robots,
      openGraph: { title: copy.title, description: copy.detail },
    };
  }

  const noun = resolved.item.kind === "video" ? "video" : "photo";
  const title = `A ${noun} from ${resolved.event.name}`;
  const description = "Shared with you through Klik. Tap to open it.";

  return {
    title,
    description,
    robots,
    openGraph: {
      title,
      description,
      type: "article",
      images: [{ url: `/api/s/${token}/og`, width: 1200, height: 630, alt: title }],
    },
    // Named explicitly rather than left to inherit. Twitter and the clients that
    // copied its tags ignore `og:image` without a card type and render a bare
    // link, and these links travel by being pasted anywhere at all.
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`/api/s/${token}/og`],
    },
  };
}

function Refusal({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display text-2xl text-paper">{title}</h1>
      <p className="mt-3 max-w-sm text-sm text-muted">{detail}</p>
      <Link
        href="/"
        className="mt-8 inline-flex min-h-11 items-center rounded-full border border-canvas-line px-5 text-sm font-medium text-paper transition-colors hover:border-volt/50 hover:text-volt"
      >
        What is Klik?
      </Link>
    </main>
  );
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolveShareRequest(token);

  if (!resolved.ok) {
    if (resolved.reason === "password") {
      return <SharePasswordGate token={token} />;
    }
    /**
     * Deliberately a 200 with an explanation rather than a 404. A Server
     * Component cannot set a status without `notFound()`, and `notFound()` would
     * replace this with the generic page and lose the one thing that matters
     * here: telling the person whether to ask for a new link or check what they
     * pasted. The routes a machine calls return the honest 404 and 410, and the
     * page is noindex in every state, so nothing is leaning on this status.
     */
    const copy = DENIAL_COPY[resolved.reason];
    return <Refusal title={copy.title} detail={copy.detail} />;
  }

  const { share, event, item } = resolved;

  return (
    <ShareView
      token={token}
      eventName={event.name}
      kind={item.kind}
      contentUrl={shareContentPath(token)}
      posterUrl={item.posterPathname ? `${shareContentPath(token)}?poster=1` : null}
      downloadUrl={share.allowDownload ? shareDownloadPath(token) : null}
      /**
       * Computed from the same helper the download route uses. The viewer saves
       * the locally enhanced bytes rather than following the link when there are
       * any, and a file that arrives under a different name depending on which
       * of those two paths ran would be a small, permanent confusion.
       */
      downloadName={shareDownloadFilename(item, extensionForMime(item.mimeType))}
      // Only offered when the gallery is genuinely open to anyone with the
      // address. Pointing a stranger at a private or password-protected gallery
      // is an invitation to a locked door.
      galleryUrl={event.visibility === "public" ? `/e/${event.slug}` : null}
    />
  );
}
