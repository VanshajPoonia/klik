import { NextResponse } from "next/server";
import { resolveVisibleMedia } from "@/lib/media-viewer";
import { reactorFor, setReaction } from "@/lib/reactions";
import { clientIp, consume } from "@/lib/ratelimit";

/**
 * MED-9: PUT hearts the item, DELETE takes the heart back. Both idempotent, so
 * a double tap or a retry lands where it was asked to.
 *
 * Anyone who can see the item and has joined the gallery may heart it; no
 * account needed. The guest cookie is who they are, which is enough for a
 * heart. Rate limited per address before any database work and per person
 * after, which is generous for tapping through a gallery and useless for
 * inflating a count.
 */
async function handle(request: Request, params: Promise<{ slug: string; mediaId: string }>, on: boolean) {
  const ip = clientIp(request);
  const perIp = await consume(`react:ip:${ip}`, 600, 60 * 60);
  if (!perIp.allowed) return tooMany(perIp.retryAfter);

  const { slug, mediaId } = await params;
  const found = await resolveVisibleMedia(slug, mediaId);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!found.event.reactionsEnabled) {
    return NextResponse.json({ error: "Hearts are off for this gallery." }, { status: 403 });
  }
  const reactor = reactorFor({ guestId: found.guestId, userId: found.managerUserId });
  if (!reactor) return NextResponse.json({ error: "Join the gallery first." }, { status: 401 });

  const who = "guestId" in reactor ? `g:${reactor.guestId}` : `u:${reactor.userId}`;
  const perPerson = await consume(`react:${who}`, 120, 10 * 60);
  if (!perPerson.allowed) return tooMany(perPerson.retryAfter);

  const result = await setReaction(found.item.id, reactor, on);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}

function tooMany(retryAfter: number) {
  return NextResponse.json(
    { error: "That is a lot of hearts. Give it a minute." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

export async function PUT(request: Request, { params }: { params: Promise<{ slug: string; mediaId: string }> }) {
  return handle(request, params, true);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string; mediaId: string }> }) {
  return handle(request, params, false);
}
