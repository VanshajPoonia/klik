/**
 * Copies every object from one R2 bucket into another (ROADMAP OPS-4).
 *
 * This exists because R2 fixes jurisdiction at bucket creation, so leaving the
 * EU means a different bucket, and a different bucket means moving the bytes.
 *
 * Two things it deliberately does NOT do:
 *
 * - It never deletes from the source. The old bucket stays intact until you
 *   have looked at the new one and are satisfied, because the failure that
 *   matters here is losing the only copy of somebody's wedding.
 * - It does not use CopyObject. Source and destination are different endpoints
 *   once jurisdiction differs, and a server-side copy cannot cross them, so
 *   each object is read and written through this process.
 *
 * It is safe to run repeatedly. An object already present at the destination
 * with the same size is skipped, so an interrupted run resumes rather than
 * starting over.
 *
 * Reads nothing from .env.local, because the destination needs a token the app
 * does not have. Pass everything explicitly:
 *
 *   R2_ACCOUNT_ID=...
 *   R2_SRC_BUCKET=klik-media
 *   R2_SRC_ENDPOINT=https://<account>.eu.r2.cloudflarestorage.com
 *   R2_SRC_ACCESS_KEY_ID=...  R2_SRC_SECRET_ACCESS_KEY=...
 *   R2_DST_BUCKET=klik-media-us
 *   R2_DST_ENDPOINT=https://<account>.r2.cloudflarestorage.com
 *   R2_DST_ACCESS_KEY_ID=...  R2_DST_SECRET_ACCESS_KEY=...
 *
 *   node scripts/copy-bucket.mjs            # lists what it would copy
 *   node scripts/copy-bucket.mjs --apply    # actually copies
 */
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

const APPLY = process.argv.includes("--apply");

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. See the comment at the top of this file.`);
    process.exit(1);
  }
  return value;
}

const client = (endpoint, keyId, secret) =>
  new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId: keyId, secretAccessKey: secret },
  });

const src = client(
  required("R2_SRC_ENDPOINT"),
  required("R2_SRC_ACCESS_KEY_ID"),
  required("R2_SRC_SECRET_ACCESS_KEY"),
);
const dst = client(
  required("R2_DST_ENDPOINT"),
  required("R2_DST_ACCESS_KEY_ID"),
  required("R2_DST_SECRET_ACCESS_KEY"),
);
const SRC_BUCKET = required("R2_SRC_BUCKET");
const DST_BUCKET = required("R2_DST_BUCKET");

/** Every key in the source, following pagination rather than trusting one page. */
async function listAll() {
  const keys = [];
  let token;
  do {
    const page = await src.send(
      new ListObjectsV2Command({ Bucket: SRC_BUCKET, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) keys.push({ key: object.Key, size: object.Size });
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Size match is the resume check. Not a checksum, but it catches a truncated write. */
async function alreadyThere(key, size) {
  try {
    const head = await dst.send(new HeadObjectCommand({ Bucket: DST_BUCKET, Key: key }));
    return head.ContentLength === size;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`Source:      ${SRC_BUCKET} at ${process.env.R2_SRC_ENDPOINT}`);
  console.log(`Destination: ${DST_BUCKET} at ${process.env.R2_DST_ENDPOINT}`);
  console.log(APPLY ? "Mode:        COPYING\n" : "Mode:        dry run, pass --apply to copy\n");

  const objects = await listAll();
  const totalBytes = objects.reduce((sum, object) => sum + object.size, 0);
  console.log(`${objects.length} objects, ${(totalBytes / 1024 / 1024).toFixed(1)} MB\n`);

  let copied = 0;
  let skipped = 0;
  const failures = [];

  for (const { key, size } of objects) {
    if (await alreadyThere(key, size)) {
      skipped += 1;
      console.log(`skip  ${key}`);
      continue;
    }
    if (!APPLY) {
      console.log(`would  ${key}  (${size} bytes)`);
      continue;
    }
    try {
      const object = await src.send(new GetObjectCommand({ Bucket: SRC_BUCKET, Key: key }));
      const body = Buffer.from(await object.Body.transformToByteArray());
      // ContentType is carried over because the signed download URLs set
      // ResponseContentType from the database, but a direct fetch of the object
      // falls back to whatever the object itself claims.
      await dst.send(
        new PutObjectCommand({
          Bucket: DST_BUCKET,
          Key: key,
          Body: body,
          ContentType: object.ContentType,
        }),
      );
      if (body.length !== size) throw new Error(`read ${body.length} bytes, expected ${size}`);
      copied += 1;
      console.log(`copy  ${key}`);
    } catch (error) {
      failures.push({ key, message: error.message });
      console.error(`FAIL  ${key}: ${error.message}`);
    }
  }

  console.log(`\ncopied ${copied}, skipped ${skipped}, failed ${failures.length}`);
  if (failures.length > 0) {
    console.error("\nRe-run to retry the failures. Nothing was deleted from the source.");
    process.exit(1);
  }
  if (APPLY) console.log("Source bucket untouched. Delete it only after verifying the new one.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
