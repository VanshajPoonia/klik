import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { deleteBlobs, r2 } from "./storage";
import { SIGNATURE_BYTES, detectMediaSignature } from "./file-signature";
import { log } from "./observability";

/**
 * Decides whether a poster or thumbnail the client says it uploaded can be
 * recorded against a media row.
 *
 * The client names the key, so the key is checked against the one this media
 * id would have been given. That check is the security property: before it, a
 * guest could register a video whose "poster" was any object in the bucket they
 * knew the key of, and the content route would sign it for them. Keys are
 * random, so this was hard to exploit, but it was the content route handing out
 * a signature for something the caller never uploaded.
 *
 * Then the object is held to the same standard as any upload: it must exist,
 * fit its cap, and actually be a JPEG. Anything else is deleted (it sits at our
 * own key, so that is safe) and the row is recorded without it. Never fatal:
 * a missing still costs a nicer tile, not the guest's upload.
 */
export async function acceptDerivedObject({
  claimed,
  expected,
  maxBytes,
  label,
}: {
  claimed: string | null | undefined;
  expected: string;
  maxBytes: number;
  label: "poster" | "thumbnail";
}): Promise<string | null> {
  if (!claimed) return null;
  if (claimed !== expected) {
    // Not ours to delete: it may be somebody else's object.
    log.warn("upload.derived_key_mismatch", { label });
    return null;
  }

  try {
    const head = await r2.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: expected }));
    const size = head.ContentLength ?? 0;
    if (!size || size > maxBytes) throw new Error(`${label} is ${size} bytes`);

    const start = await r2.send(
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: expected,
        Range: `bytes=0-${SIGNATURE_BYTES - 1}`,
      }),
    );
    const signature = detectMediaSignature(await start.Body!.transformToByteArray());
    if (signature?.format !== "jpeg") throw new Error(`${label} is not a JPEG`);
    return expected;
  } catch (error) {
    log.warn("upload.derived_rejected", { label, error });
    await deleteBlobs([expected]).catch(() => {});
    return null;
  }
}
