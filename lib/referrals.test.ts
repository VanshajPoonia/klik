import { describe, expect, it } from "vitest";
import { formatCents, isReferralCode } from "./referrals";

describe("GRW-5 referral codes and money", () => {
  it("accepts the codes the database makes and nothing that could be a path", () => {
    expect(isReferralCode("3f9a0c1b2d")).toBe(true);
    expect(isReferralCode("../admin")).toBe(false);
    expect(isReferralCode("ABC")).toBe(false);
    expect(isReferralCode(null)).toBe(false);
  });

  it("writes dollars the way people do", () => {
    expect(formatCents(1000)).toBe("$10");
    expect(formatCents(1050)).toBe("$10.50");
    expect(formatCents(-500)).toBe("-$5");
  });
});
