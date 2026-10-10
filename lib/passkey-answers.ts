import { z } from "zod";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

/**
 * ACC-6: the shape of what a browser sends back from a passkey prompt, checked
 * before any of it reaches the verifier. Only shape: whether the signature is
 * good is lib/passkeys.ts's job. Kept apart from that file so it can be tested
 * without a database.
 */

const b64url = z.string().min(1).max(8192).regex(/^[A-Za-z0-9_-]+$/);
const TRANSPORTS = ["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"] as const;

const registration = z.object({
  id: b64url,
  rawId: b64url,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: b64url,
    attestationObject: b64url,
    authenticatorData: b64url.optional(),
    // Unknown names are dropped rather than refused: the list grows.
    transports: z
      .array(z.string().max(32))
      .max(10)
      .optional()
      .transform((list) => list?.filter((name): name is (typeof TRANSPORTS)[number] => (TRANSPORTS as readonly string[]).includes(name))),
    publicKeyAlgorithm: z.number().int().optional(),
    publicKey: b64url.optional(),
  }),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
});

const authentication = z.object({
  id: b64url,
  rawId: b64url,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: b64url,
    authenticatorData: b64url,
    signature: b64url,
    userHandle: b64url.optional(),
  }),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
});

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parsePasskeyRegistration(raw: unknown): RegistrationResponseJSON | null {
  const parsed = registration.safeParse(parseJson(raw));
  return parsed.success ? (parsed.data as RegistrationResponseJSON) : null;
}

export function parsePasskeyAnswer(raw: unknown): AuthenticationResponseJSON | null {
  const parsed = authentication.safeParse(parseJson(raw));
  return parsed.success ? (parsed.data as AuthenticationResponseJSON) : null;
}
