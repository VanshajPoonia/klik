import { once } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { r2 } from "./storage";
import { zipEntryName } from "./download-batches";

export interface ZipItem {
  id: string;
  kind: "photo" | "video";
  mimeType: string;
  blobPathname: string;
}

/**
 * A ZIP streamed straight from R2 to the browser, one object at a time, never
 * held in memory. Stored rather than compressed, because photos and videos are
 * already compressed and deflating them only costs time inside a function that
 * has five minutes.
 *
 * Used by the organizer's download and by share links, so a gallery comes out
 * named the same way whichever of them packed it.
 */
export function streamZip(items: ZipItem[], filename: string, headers: Record<string, string> = {}): NextResponse {
  const output = new PassThrough();
  const archive = new ZipArchive({ zlib: { level: 0 } });
  archive.on("error", (error) => output.destroy(error));
  archive.pipe(output);

  void (async () => {
    for (const [index, item] of items.entries()) {
      const object = await r2.send(
        new GetObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: item.blobPathname,
        }),
      );
      if (!object.Body || !(object.Body instanceof Readable)) {
        throw new Error(`Media object ${item.id} did not return a readable body`);
      }

      const consumed = once(object.Body, "end");
      archive.append(object.Body, { name: zipEntryName(index, item) });
      await consumed;
    }
    await archive.finalize();
  })().catch((error) => output.destroy(error instanceof Error ? error : new Error(String(error))));

  return new NextResponse(Readable.toWeb(output) as ReadableStream<Uint8Array>, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/zip",
      ...headers,
    },
  });
}
