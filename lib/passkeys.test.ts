import { describe, expect, it } from "vitest";
import { cleanPasskeyName, cookieFrom, defaultPasskeyName, deviceFromUserAgent, relyingPartyFor } from "./passkeys";
import { parsePasskeyAnswer, parsePasskeyRegistration } from "./passkey-answers";

describe("ACC-6 relying party", () => {
  it("accepts only Klik's own address", () => {
    expect(relyingPartyFor("https://example.test/api/passkeys/options")).toEqual({ id: "example.test", origin: "https://example.test" });
    expect(relyingPartyFor("https://klik-git-branch.vercel.app/api/passkeys/options")).toBeNull();
    expect(relyingPartyFor("https://example.test.evil.com/api/passkeys/options")).toBeNull();
  });
});

describe("ACC-6 naming", () => {
  it("names a passkey after the password manager that made it, then the device", () => {
    expect(defaultPasskeyName("fbfc3007-154e-4ecc-8c0b-6e020557d7bd", "Mozilla/5.0 (iPhone)")).toBe("iCloud Keychain");
    expect(defaultPasskeyName(null, "Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari")).toBe("Android phone");
    expect(defaultPasskeyName("11111111-2222-3333-4444-555555555555", null)).toBe("Passkey");
  });

  it("reads the device from the browser", () => {
    expect(deviceFromUserAgent("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)")).toBe("iPad");
    expect(deviceFromUserAgent("Mozilla/5.0 (Linux; Android 15; SM-X710)")).toBe("Android tablet");
    expect(deviceFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("Mac");
    expect(deviceFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows computer");
    expect(deviceFromUserAgent(null)).toBeNull();
  });

  it("tidies a name and refuses an empty one", () => {
    expect(cleanPasskeyName("  Ana's \n phone ")).toBe("Ana's phone");
    expect(cleanPasskeyName("   ")).toBeNull();
    expect(cleanPasskeyName("x".repeat(80))).toHaveLength(60);
  });
});

describe("ACC-6 cookies", () => {
  it("finds one cookie in a header", () => {
    expect(cookieFrom("a=1; klik_passkey=abc.def; b=2", "klik_passkey")).toBe("abc.def");
    expect(cookieFrom("klik_passkeyx=1", "klik_passkey")).toBeUndefined();
    expect(cookieFrom(null, "klik_passkey")).toBeUndefined();
  });
});

describe("ACC-6 answer shapes", () => {
  const answer = {
    id: "abc_-",
    rawId: "abc_-",
    type: "public-key",
    response: { clientDataJSON: "eyJ0", authenticatorData: "AAAA", signature: "MEUC", userHandle: "dXNy" },
    clientExtensionResults: {},
  };

  it("accepts a sign-in answer as JSON or as an object", () => {
    expect(parsePasskeyAnswer(JSON.stringify(answer))?.id).toBe("abc_-");
    expect(parsePasskeyAnswer(answer)?.response.userHandle).toBe("dXNy");
  });

  it("refuses anything that is not base64url, or not JSON", () => {
    expect(parsePasskeyAnswer({ ...answer, id: "abc+/" })).toBeNull();
    expect(parsePasskeyAnswer({ ...answer, type: "password" })).toBeNull();
    expect(parsePasskeyAnswer("{not json")).toBeNull();
  });

  it("keeps known transports and drops unknown ones", () => {
    const parsed = parsePasskeyRegistration({
      id: "abc",
      rawId: "abc",
      type: "public-key",
      response: { clientDataJSON: "eyJ0", attestationObject: "o2Nm", transports: ["internal", "carrier-pigeon", "hybrid"] },
    });
    expect(parsed?.response.transports).toEqual(["internal", "hybrid"]);
  });
});
