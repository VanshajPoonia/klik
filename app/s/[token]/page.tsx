import type { Metadata } from "next";
import Link from "next/link";
import {
  denialCopy,
  isCollectionScope,
  shareContentPath,
  shareDownloadFilename,
  shareDownloadPath,
} from "@/lib/share-access";
import { extensionForMime } from "@/lib/storage";
import { loadShare, resolveShareRequest, type CollectionRequest } from "@/lib/share-request";
import { allCollectionItems, collectionSummary, listCollectionItems, toSharedItems } from "@/lib/shares";
import { rollUndeveloped } from "@/lib/media-access";
import { INLINE_ZIP_LIMIT_BYTES, buildDownloadBatches } from "@/lib/download-batches";
import { ShareView } from "@/components/share/share-view";
import { ShareCollection } from "@/components/share/share-collection";
import { SharePasswordGate } from "@/components/share/share-password-gate";

/**
 * A photo, a folder or a selection, reachable by token alone.
 *
 * Deliberately not the gallery. Somebody arriving here was sent something by
 * one person, and very likely has never heard of Klik. So the page is the
 * photos, a line saying where they came from, and one way out.
 */

/** What a folder or selection link's page and its preview are called. */
function collectionTitle(resolved: Pick<CollectionRequest, "event" | "folder">, count: number): string {
  if (resolved.folder) return `${resolved.folder.name}, from ${resolved.event.name}`;
  return `${count} ${count === 1 ? "photo" : "photos"} from ${resolved.event.name}`;
}

/** Whether a token is a folder or selection link, for wording a refusal. */
async function isCollection(token: string): Promise<boolean> {
  const loaded = await loadShare(token);
  return loaded ? isCollectionScope(loaded.share.scope) : false;
}

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
    const copy = denialCopy(resolved.reason, resolved.share ? isCollectionScope(resolved.share.scope) : false);
    return {
      title: copy.title,
      description: copy.detail,
      robots,
      openGraph: { title: copy.title, description: copy.detail },
    };
  }

  let title: string;
  let description: string;
  if (resolved.item) {
    title = `A ${resolved.item.kind === "video" ? "video" : "photo"} from ${resolved.event.name}`;
    description = "Shared with you through Klik. Tap to open it.";
  } else {
    const { count } = await collectionSummary(resolved.share, resolved.event);
    title = collectionTitle(resolved, count);
    description = "Shared with you through Klik. Tap to see them.";
  }

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
    const collection = await isCollection(token);
    if (resolved.reason === "password") {
      return <SharePasswordGate token={token} collection={collection} />;
    }
    /**
     * Deliberately a 200 with an explanation rather than a 404. A Server
     * Component cannot set a status without `notFound()`, and `notFound()` would
     * replace this with the generic page and lose the one thing that matters
     * here: telling the person whether to ask for a new link or check what they
     * pasted. The routes a machine calls return the honest 404 and 410, and the
     * page is noindex in every state, so nothing is leaning on this status.
     */
    const copy = denialCopy(resolved.reason, collection);
    return <Refusal title={copy.title} detail={copy.detail} />;
  }

  // Only offered when the gallery is genuinely open to anyone with the
  // address. Pointing a stranger at a private or password-protected gallery is
  // an invitation to a locked door.
  const galleryUrl = resolved.event.visibility === "public" ? `/e/${resolved.event.slug}` : null;

  if (!resolved.item) {
    const { share, event, folder } = resolved;
    const [summary, firstPage] = await Promise.all([
      collectionSummary(share, event),
      listCollectionItems(share, event),
    ]);
    // A selection whose every photo has gone points at nothing, which is a
    // broken link rather than an empty one. A folder can fill up again.
    if (share.scope === "selection" && summary.count === 0) {
      const copy = denialCopy("not_found", true);
      return <Refusal title={copy.title} detail={copy.detail} />;
    }
    const zipParts =
      share.allowDownload && summary.count > 0
        ? buildDownloadBatches(await allCollectionItems(share, event), INLINE_ZIP_LIMIT_BYTES).length
        : 0;
    return (
      <ShareCollection
        token={token}
        eventName={event.name}
        folderName={folder?.name ?? null}
        count={summary.count}
        initialItems={await toSharedItems(token, firstPage.items)}
        initialCursor={firstPage.nextCursor}
        canDownload={share.allowDownload}
        zipParts={zipParts}
        undeveloped={share.scope === "album" && rollUndeveloped(event)}
        galleryUrl={galleryUrl}
      />
    );
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
      galleryUrl={galleryUrl}
    />
  );
}
