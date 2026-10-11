import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Secrets Klik creates for itself at a provider and keeps in the database
 * (OPS-1's Stream signing key and webhook secret), sealed with AES-256-GCM
 * under a key derived from `AUTH_SECRET`. A copy of the database alone then
 * cannot sign a playback token or forge a webhook.
 *
 * Rotating `AUTH_SECRET` (INCIDENTS.md) makes every sealed value unreadable,
 * which is the right outcome: `open` returns null, and the caller makes a new
 * secret at the provider, as it does the first time.
 */

const VERSION = "v1";

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required to seal secrets");
  return Buffer.from(hkdfSync("sha256", secret, "klik", "provider-secrets", 32));
}

export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), body.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

/** The plaintext, or null for anything this key did not seal. Never throws. */
export function open(sealed: string): string | null {
  try {
    const [version, iv, body, tag] = sealed.split(".");
    if (version !== VERSION || !iv || !body || !tag) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
