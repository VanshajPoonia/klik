import { NextResponse } from "next/server";
import { resolveCollectionRequest } from "@/lib/share-request";
import { denialCopy, denialStatus } from "@/lib/share-access";
import { listCollectionItems, toSharedItems } from "@/lib/shares";

/**
 * The next page of a folder or selection link's photos. The gate runs on every
 * page, so a link turned off stops the scroll at the next request.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolveCollectionRequest(token);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: denialCopy(resolved.reason, true).title },
      { status: denialStatus(resolved.reason), headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const cursor = new URL(request.url).searchParams.get("cursor");
  const page = await listCollectionItems(resolved.share, resolved.event, { cursor });
  return NextResponse.json(
    { items: await toSharedItems(token, page.items), nextCursor: page.nextCursor },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
