import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { eq, sql } from "drizzle-orm";

// A bucket in memory that speaks just enough S3 for the export path: reads,
// multipart writes, listing and deletes. The ZIP is built by the real archiver
// and the rows by the real database, so what is tested is what ships.
const bucket = new Map<string, Buffer>();
const pending = new Map<string, Buffer[]>();
const deleted: string[] = [];
const send = vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
  const input = command.input as { Key: string; UploadId?: string; Body?: Buffer; PartNumber?: number };
  switch (command.constructor.name) {
    case "GetObjectCommand": {
      const bytes = bucket.get(input.Key);
      if (!bytes) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
      return { Body: Readable.from([bytes]) };
    }
    case "CreateMultipartUploadCommand":
      pending.set(input.Key, []);
      return { UploadId: `up_${input.Key}` };
    case "UploadPartCommand":
      pending.get(input.Key)!.push(Buffer.from(input.Body!));
      return { ETag: `etag_${input.PartNumber}` };
    case "CompleteMultipartUploadCommand":
      bucket.set(input.Key, Buffer.concat(pending.get(input.Key)!));
      pending.delete(input.Key);
      return {};
    case "AbortMultipartUploadCommand":
      pending.delete(input.Key);
      return {};
    case "ListObjectsV2Command": {
      const prefix = (command.input as { Prefix?: string }).Prefix ?? "";
      return {
        Contents: [...bucket.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((Key) => ({ Key, LastModified: lastModified.get(Key) ?? new Date() })),
        IsTruncated: false,
      };
    }
    default:
      throw new Error(`Unexpected ${command.constructor.name}`);
  }
});
const lastModified = new Map<string, Date>();
const deleteBlobs = vi.fn(async (keys: string[]) => {
  for (const key of keys) {
    bucket.delete(key);
    deleted.push(key);
  }
});

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  r2: { send },
  deleteBlobs,
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ sent: true })), isEmailConfigured: () => true }));

const { createExport, deleteEventExports, expireExports, recordPartBuilt } = await import("@/lib/exports");
const { buildExportPart } = await import("@/lib/job-handlers/export");
const { eraseEvent } = await import("@/lib/erasure");
const { jobs, mediaExports } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

const context = { jobId: "j", attempt: 1, maxAttempts: 3, deadline: Date.now() + 60_000 };
const GB = 1024 * 1024 * 1024;
/** 1.5 GB then two of 0.5 GB: the first fills a part on its own under the
 *  1.8 GB cap, the other two share the second. */
const twoParts = (ids: string[]) => ids.map((id, index) => ({ id, sizeBytes: index === 0 ? 1.5 * GB : 0.5 * GB }));
const exportRow = async (id: string) => (await testDb.select().from(mediaExports).where(eq(mediaExports.id, id)))[0];

beforeEach(async () => {
  bucket.clear();
  pending.clear();
  lastModified.clear();
  deleted.length = 0;
  send.mockClear();
  deleteBlobs.mockClear();
  await resetDatabase();
});

afterAll(closeDatabase);

async function galleryWith(count: number) {
  const owner = await makeUser();
  const eventId = await makeEvent(owner);
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = await makeMedia(eventId, { sizeBytes: 11 });
    bucket.set(`events/${eventId}/${id}.jpg`, Buffer.from(`photo-${index}`));
    ids.push(id);
  }
  return { owner, eventId, ids };
}

describe("createExport", () => {
  it("splits into parts by the same rule as the streamed ZIP, one job each", async () => {
    const { owner, eventId, ids } = await galleryWith(3);
    const row = await createExport({ eventId, requestedByUserId: owner, label: "Everything", items: twoParts(ids) });
    expect(row.partCount).toBe(2);
    expect(row.parts.map((part) => part.items.length)).toEqual([1, 2]);
    expect((await testDb.select().from(jobs)).map((job) => job.kind)).toEqual(["export.part", "export.part"]);
  });
});

describe("buildExportPart", () => {
  it("writes a ZIP of the part into exports/, and marks the export ready when it is the last", async () => {
    const { owner, eventId, ids } = await galleryWith(2);
    const row = await createExport({
      eventId,
      requestedByUserId: owner,
      label: "Everything",
      items: ids.map((id) => ({ id, sizeBytes: 11 })),
    });

    await buildExportPart({ exportId: row.id, part: 0 }, context);

    const key = `exports/${eventId}/${row.id}/part-1.zip`;
    const zip = bucket.get(key)!;
    expect(zip.subarray(0, 2).toString()).toBe("PK");
    expect(zip.toString("latin1")).toContain("photo-0");
    expect(zip.toString("latin1")).toContain(`001-photo-${ids[0].slice(0, 8)}.jpg`);
    const after = await exportRow(row.id);
    expect(after.status).toBe("ready");
    expect(after.parts[0]).toMatchObject({ key, files: 2 });
    expect(after.expiresAt).not.toBeNull();
  });

  it("numbers files across parts, so part two carries on from part one", async () => {
    const { owner, eventId, ids } = await galleryWith(3);
    const row = await createExport({
      eventId,
      requestedByUserId: owner,
      label: "Everything",
      items: twoParts(ids),
    });
    await buildExportPart({ exportId: row.id, part: 1 }, context);
    const zip = bucket.get(`exports/${eventId}/${row.id}/part-2.zip`)!.toString("latin1");
    expect(zip).toContain(`002-photo-${ids[1].slice(0, 8)}`);
    expect(zip).toContain(`003-photo-${ids[2].slice(0, 8)}`);
    expect((await exportRow(row.id)).status).toBe("building");
  });

  it("leaves out a photo deleted after the export was asked for", async () => {
    const { owner, eventId, ids } = await galleryWith(2);
    const row = await createExport({
      eventId,
      requestedByUserId: owner,
      label: "Everything",
      items: ids.map((id) => ({ id, sizeBytes: 11 })),
    });
    await testDb.execute(sql`UPDATE media SET deleted_at = now() WHERE id = ${ids[1]}`);
    await buildExportPart({ exportId: row.id, part: 0 }, context);
    expect((await exportRow(row.id)).parts[0].files).toBe(1);
  });

  it("aborts the upload and keeps no half-written ZIP when a photo cannot be read", async () => {
    const { owner, eventId, ids } = await galleryWith(2);
    bucket.delete(`events/${eventId}/${ids[1]}.jpg`);
    const row = await createExport({
      eventId,
      requestedByUserId: owner,
      label: "Everything",
      items: ids.map((id) => ({ id, sizeBytes: 11 })),
    });
    await expect(buildExportPart({ exportId: row.id, part: 0 }, context)).rejects.toThrow("NoSuchKey");
    expect(bucket.has(`exports/${eventId}/${row.id}/part-1.zip`)).toBe(false);
    expect(pending.size).toBe(0);
    expect((await exportRow(row.id)).status).toBe("building");
  });

  it("marks the export failed when its last attempt fails, so the dashboard stops waiting", async () => {
    const { owner, eventId, ids } = await galleryWith(1);
    bucket.delete(`events/${eventId}/${ids[0]}.jpg`);
    const row = await createExport({ eventId, requestedByUserId: owner, label: "Everything", items: [{ id: ids[0], sizeBytes: 11 }] });
    await expect(buildExportPart({ exportId: row.id, part: 0 }, { ...context, attempt: 3 })).rejects.toThrow();
    expect((await exportRow(row.id)).status).toBe("failed");
  });
});

describe("recordPartBuilt", () => {
  it("counts a part once however many times its job runs", async () => {
    const { owner, eventId, ids } = await galleryWith(3);
    const row = await createExport({
      eventId,
      requestedByUserId: owner,
      label: "Everything",
      items: twoParts(ids),
    });
    const built = { key: "exports/x/part-1.zip", bytes: 10, files: 1 };
    expect(await recordPartBuilt(row.id, 0, built)).toBeNull();
    expect(await recordPartBuilt(row.id, 0, built)).toBeNull();
    expect((await exportRow(row.id)).partsDone).toBe(1);
    expect((await recordPartBuilt(row.id, 1, { ...built, key: "exports/x/part-2.zip" }))?.status).toBe("ready");
  });
});

describe("expiry and erasure", () => {
  it("deletes an expired export's ZIPs and keeps the row to say so", async () => {
    const { owner, eventId, ids } = await galleryWith(1);
    const row = await createExport({ eventId, requestedByUserId: owner, label: "Everything", items: [{ id: ids[0], sizeBytes: 11 }] });
    await buildExportPart({ exportId: row.id, part: 0 }, context);
    await testDb.execute(sql`UPDATE exports SET expires_at = now() - interval '1 minute'`);

    const result = await expireExports();
    expect(result.expired).toBe(1);
    expect(bucket.has(`exports/${eventId}/${row.id}/part-1.zip`)).toBe(false);
    expect((await exportRow(row.id)).status).toBe("expired");
  });

  it("fails an export stuck building for a day", async () => {
    const { owner, eventId, ids } = await galleryWith(1);
    const row = await createExport({ eventId, requestedByUserId: owner, label: "Everything", items: [{ id: ids[0], sizeBytes: 11 }] });
    await testDb.execute(sql`UPDATE exports SET created_at = now() - interval '2 days'`);
    expect((await expireExports()).stuck).toBe(1);
    expect((await exportRow(row.id)).status).toBe("failed");
  });

  it("sweeps anything old under exports/ even with no row pointing at it", async () => {
    bucket.set("exports/gone-event/exp_1/part-1.zip", Buffer.from("zip"));
    lastModified.set("exports/gone-event/exp_1/part-1.zip", new Date(Date.now() - 9 * 24 * 60 * 60 * 1000));
    bucket.set("exports/live-event/exp_2/part-1.zip", Buffer.from("zip"));
    expect((await expireExports()).swept).toBe(1);
    expect(bucket.has("exports/live-event/exp_2/part-1.zip")).toBe(true);
  });

  it("is part of erasing an event, because a ZIP of the gallery is the gallery", async () => {
    const { owner, eventId, ids } = await galleryWith(1);
    const row = await createExport({ eventId, requestedByUserId: owner, label: "Everything", items: [{ id: ids[0], sizeBytes: 11 }] });
    await buildExportPart({ exportId: row.id, part: 0 }, context);
    await eraseEvent(eventId, owner, "test");
    expect(deleted).toContain(`exports/${eventId}/${row.id}/part-1.zip`);
    expect(await testDb.select().from(mediaExports)).toHaveLength(0);
  });

  it("does nothing for events with no exports", async () => {
    expect(await deleteEventExports(["nothing"])).toBe(0);
  });
});
