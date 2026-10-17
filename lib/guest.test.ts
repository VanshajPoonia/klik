import { describe, expect, it } from "vitest";
import { decodeJwt, SignJWT } from "jose";
import { GUEST_PASS_DAYS, renewGuestPass, signGuestSession, verifyEventUnlock, signEventUnlock, verifyGuestSession } from "./guest";

const DAY = 24 * 60 * 60 * 1000;

describe("guest passes", () => {
  it("last a year, not the 30 days that sent guests back to the entry sheet", async () => {
    const token = await signGuestSession({ guestId: "g1", eventId: "e1" });
    const { iat, exp } = decodeJwt(token);
    expect(exp! - iat!).toBe(GUEST_PASS_DAYS * 24 * 60 * 60);
    expect(GUEST_PASS_DAYS).toBe(365);
  });

  it("are left alone on a visit the same day, so a gallery's requests sign nothing", async () => {
    const token = await signGuestSession({ guestId: "g1", eventId: "e1" });
    expect(await renewGuestPass(token)).toBeNull();
  });

  it("are renewed for another year a day or more later, with the same claims", async () => {
    const token = await signGuestSession({ guestId: "g1", eventId: "e1", kioskId: "k1" });
    const later = Date.now() + 40 * DAY;
    const renewed = await renewGuestPass(token, later);
    expect(renewed).not.toBeNull();
    const { iat, exp } = decodeJwt(renewed!);
    expect(iat).toBe(Math.floor(later / 1000));
    expect(exp! - iat!).toBe(GUEST_PASS_DAYS * 24 * 60 * 60);
    expect(await verifyGuestSession(renewed!)).toEqual({ guestId: "g1", eventId: "e1", kioskId: "k1" });
  });

  it("renew a gallery's password unlock the same way, still tied to its access version", async () => {
    const token = await signEventUnlock("e1", 3);
    const renewed = await renewGuestPass(token, Date.now() + 2 * DAY);
    expect(await verifyEventUnlock(renewed!, "e1", 3)).toBe(true);
    expect(await verifyEventUnlock(renewed!, "e1", 4)).toBe(false);
  });

  it("never renew a token Klik did not sign, or one already expired", async () => {
    const forged = await new SignJWT({ guestId: "g1", eventId: "e1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor((Date.now() - 5 * DAY) / 1000))
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode("someone-else"));
    expect(await renewGuestPass(forged)).toBeNull();
    expect(await renewGuestPass("not a token")).toBeNull();
    const old = await new SignJWT({ guestId: "g1", eventId: "e1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor((Date.now() - 400 * DAY) / 1000))
      .setExpirationTime(Math.floor((Date.now() - DAY) / 1000))
      .sign(new TextEncoder().encode("test-auth-secret-not-used-to-sign-anything-real"));
    expect(await renewGuestPass(old)).toBeNull();
  });
});
