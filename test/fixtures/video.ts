/**
 * MP4 and QuickTime files built byte by byte, for lib/video-metadata.ts and
 * the scrub job. Real phones write location in exactly these places; the
 * parser was also checked against files ffmpeg wrote (see ROADMAP MED-8).
 */
export function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  Buffer.from(type, "latin1").copy(head, 4);
  return Buffer.concat([head, body]);
}

export function largeBox(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(16);
  head.writeUInt32BE(1, 0);
  Buffer.from(type, "latin1").copy(head, 4);
  head.writeBigUInt64BE(BigInt(16 + payload.length), 8);
  return Buffer.concat([head, payload]);
}

export const u32 = (value: number) => {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value);
  return out;
};
export const text = (value: string) => Buffer.from(value, "utf8");
export const ftyp = () => box("ftyp", text("qt  "), u32(0), text("qt  "));
export const mdat = (bytes = 4096) => box("mdat", Buffer.alloc(bytes, 0x5a));
export const mvhd = () => box("mvhd", Buffer.alloc(100, 1));

/** Android and 3GPP: `©xyz` in `udta`, a two-byte length and language, then the string. */
export function androidMoov(coords = "+37.4219-122.0840/") {
  const value = text(coords);
  const xyz = box("©xyz", Buffer.from([0, value.length, 0x15, 0xc7]), value);
  return box("moov", mvhd(), box("udta", xyz));
}

/** iPhone: a QuickTime `meta` (no version and flags) with `keys` and an `ilst`. */
export function iphoneMoov(keys: Array<[string, string]>) {
  const keyEntries = keys.map(([name]) => Buffer.concat([u32(8 + Buffer.byteLength(name)), text("mdta"), text(name)]));
  const keysBox = box("keys", u32(0), u32(keys.length), ...keyEntries);
  // Items are typed by their 1-based index into `keys`, not by a name.
  const items = keys.map(([, value], index) => {
    const data = box("data", u32(1), u32(0), text(value));
    return Buffer.concat([u32(8 + data.length), u32(index + 1), data]);
  });
  const meta = box("meta", box("hdlr", Buffer.alloc(24)), keysBox, box("ilst", ...items));
  return box("moov", mvhd(), meta);
}


/** A whole iPhone-style video with a location and a capture time. */
export function iphoneVideo(): Buffer {
  return Buffer.concat([
    ftyp(),
    iphoneMoov([
      ["com.apple.quicktime.location.ISO6709", "+51.5007-000.1246+011.000/"],
      ["com.apple.quicktime.creationdate", "2023-07-15T14:03:12+0200"],
    ]),
    mdat(64_000),
  ]);
}
