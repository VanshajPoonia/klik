import type { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { r2 } from "./storage";

/** 16 MB: well above S3's 5 MB floor, small enough to hold one in memory. */
export const PART_SIZE = 16 * 1024 * 1024;

/**
 * Takes the stream's next `size` bytes off the front of `queue`, or everything
 * left when `size` is larger. R2 insists every part but the last is exactly the
 * same size, so parts are cut to length rather than sent as chunks arrive.
 */
export function takeBytes(queue: Buffer[], size: number): Buffer {
  const out: Buffer[] = [];
  let needed = size;
  while (needed > 0 && queue.length > 0) {
    const head = queue[0];
    if (head.length <= needed) {
      out.push(head);
      queue.shift();
      needed -= head.length;
    } else {
      out.push(head.subarray(0, needed));
      queue[0] = head.subarray(needed);
      needed = 0;
    }
  }
  return Buffer.concat(out);
}

/**
 * Streams `body` into one R2 object with a multipart upload, without ever
 * holding more than about one part in memory: while a part uploads, nothing
 * reads from `body`, so whatever is producing it (the ZIP writer) is held back
 * by ordinary stream backpressure.
 *
 * On any failure the upload is aborted, so R2 is not left holding invisible,
 * billable parts of a file that will never complete.
 */
export async function uploadStream({
  key,
  body,
  contentType,
  contentDisposition,
  partSize = PART_SIZE,
}: {
  key: string;
  body: Readable;
  contentType: string;
  contentDisposition?: string;
  partSize?: number;
}): Promise<{ bytes: number }> {
  const bucket = process.env.R2_BUCKET_NAME;
  const created = await r2.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      ContentDisposition: contentDisposition,
    }),
  );
  const uploadId = created.UploadId!;
  const parts: Array<{ ETag: string; PartNumber: number }> = [];
  const queue: Buffer[] = [];
  let queued = 0;
  let total = 0;

  const send = async (chunk: Buffer) => {
    const PartNumber = parts.length + 1;
    const result = await r2.send(
      new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber, Body: chunk }),
    );
    parts.push({ ETag: result.ETag!, PartNumber });
    total += chunk.length;
  };

  try {
    for await (const chunk of body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      queue.push(buffer);
      queued += buffer.length;
      while (queued >= partSize) {
        const part = takeBytes(queue, partSize);
        queued -= part.length;
        await send(part);
      }
    }
    if (queued > 0 || parts.length === 0) await send(takeBytes(queue, queued));

    await r2.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
    return { bytes: total };
  } catch (error) {
    await r2
      .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }))
      .catch(() => {});
    throw error;
  }
}
