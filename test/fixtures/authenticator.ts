import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { isoBase64URL, isoCBOR, isoUint8Array } from "@simplewebauthn/server/helpers";

/**
 * ACC-6: a passkey authenticator in software, for tests. It makes real P-256
 * keys and real signatures in the formats a phone sends, so the verifier under
 * test is the real one, not a mock that agrees with whatever it is told.
 */

const sha256 = (data: Uint8Array | string) => new Uint8Array(createHash("sha256").update(data).digest());
const b64 = (bytes: Uint8Array) => isoBase64URL.fromBuffer(bytes as Uint8Array<ArrayBuffer>);

function counterBytes(counter: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, counter);
  return bytes;
}

export class SoftwareAuthenticator {
  readonly credentialId = new Uint8Array(randomBytes(16));
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  counter: number;

  constructor(
    private readonly options: { rpId: string; origin: string; synced?: boolean; counter?: number } = {
      rpId: "example.test",
      origin: "https://example.test",
    },
  ) {
    ({ privateKey: this.privateKey, publicKey: this.publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" }));
    this.counter = options.counter ?? 0;
  }

  get id() {
    return b64(this.credentialId);
  }

  private flags(extra: number) {
    // User present, user verified, and for a synced passkey eligible and backed up.
    return 0x01 | 0x04 | (this.options.synced === false ? 0 : 0x08 | 0x10) | extra;
  }

  private cosePublicKey() {
    const jwk = this.publicKey.export({ format: "jwk" });
    return isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, isoBase64URL.toBuffer(jwk.x!)],
        [-3, isoBase64URL.toBuffer(jwk.y!)],
      ]),
    );
  }

  /** Answers a registration prompt the way a phone does, with no attestation. */
  register(challenge: string, { origin = this.options.origin, aaguid = new Uint8Array(16) } = {}) {
    const clientDataJSON = isoUint8Array.fromUTF8String(
      JSON.stringify({ type: "webauthn.create", challenge, origin, crossOrigin: false }),
    );
    const idLength = new Uint8Array(2);
    new DataView(idLength.buffer).setUint16(0, this.credentialId.length);
    const authData = isoUint8Array.concat([
      sha256(this.options.rpId),
      new Uint8Array([this.flags(0x40)]),
      counterBytes(this.counter),
      aaguid,
      idLength,
      this.credentialId,
      this.cosePublicKey(),
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]) as never,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key" as const,
      response: {
        clientDataJSON: b64(clientDataJSON),
        attestationObject: b64(attestationObject),
        transports: ["internal", "hybrid"],
      },
      authenticatorAttachment: "platform" as const,
      clientExtensionResults: {},
    };
  }

  /** Answers a sign-in prompt, signing for `userId`. */
  authenticate(challenge: string, userId: string, { origin = this.options.origin } = {}) {
    if (this.counter > 0) this.counter += 1;
    const clientDataJSON = isoUint8Array.fromUTF8String(
      JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false }),
    );
    const authData = isoUint8Array.concat([
      sha256(this.options.rpId),
      new Uint8Array([this.flags(0)]),
      counterBytes(this.counter),
    ]);
    const signature = new Uint8Array(sign("sha256", isoUint8Array.concat([authData, sha256(clientDataJSON)]), this.privateKey));
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key" as const,
      response: {
        clientDataJSON: b64(clientDataJSON),
        authenticatorData: b64(authData),
        signature: b64(signature),
        userHandle: isoBase64URL.fromUTF8String(userId),
      },
      authenticatorAttachment: "platform" as const,
      clientExtensionResults: {},
    };
  }
}
