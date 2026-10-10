import { NextResponse } from "next/server";
import { and, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailSuppressions, guests } from "@/lib/schema";
import { emailHash, verifyUnsubscribe } from "@/lib/recap";
import { log } from "@/lib/observability";

/**
 * GRW-1: never email this address a recap again. POST only, so a mail
 * scanner following links cannot do it by accident: mail apps' own
 * "Unsubscribe" button POSTs here (RFC 8058), and the page in the footer link
 * has a button that does.
 *
 * Signed with the address's hash, so nobody can unsubscribe someone else.
 * Stores only the hash, and lets go of any recap still waiting for it.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const hash = url.searchParams.get("e") ?? "";
  const signature = url.searchParams.get("s") ?? "";
  const fromPage = (request.headers.get("accept") ?? "").includes("text/html");
  const language = url.searchParams.get("l") === "es" ? "&l=es" : "";
  if (!verifyUnsubscribe(hash, signature)) {
    return fromPage
      ? NextResponse.redirect(new URL(`/unsubscribe?invalid=1${language}`, request.url), 303)
      : NextResponse.json({ error: "Invalid link" }, { status: 400 });
  }

  await db.insert(emailSuppressions).values({ emailHash: hash, reason: "unsubscribed" }).onConflictDoNothing();

  // A request from the same address still waiting, at any gallery, goes too.
  // Few rows hold an address at all, since sending clears it, and they are
  // stored lower-cased, so hashing each is the lookup.
  const waiting = await db
    .selectDistinct({ email: guests.recapEmail })
    .from(guests)
    .where(and(isNotNull(guests.recapEmail), isNull(guests.recapSentAt)));
  const theirs = waiting.map((row) => row.email as string).filter((email) => emailHash(email) === hash);
  if (theirs.length > 0) {
    await db.update(guests).set({ recapEmail: null }).where(inArray(guests.recapEmail, theirs));
  }
  log.info("recap.unsubscribed", { released: theirs.length });

  return fromPage
    ? NextResponse.redirect(new URL(`/unsubscribe?done=1${language}`, request.url), 303)
    : NextResponse.json({ ok: true });
}
