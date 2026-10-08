import { describe, expect, it } from "vitest";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { isUniqueViolation, pgErrorCode, raisedBy } from "./db-errors";

function driverError(message: string, code: string) {
  return Object.assign(new Error(message), { code });
}

describe("pgErrorCode", () => {
  it("reads the code off Drizzle's wrapper, where it actually lives", () => {
    const wrapped = new DrizzleQueryError("insert into users ...", [], driverError("duplicate key", "23505"));
    // The bug this exists for: the wrapper itself has no code.
    expect((wrapped as unknown as { code?: string }).code).toBeUndefined();
    expect(pgErrorCode(wrapped)).toBe("23505");
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it("reads a bare driver error too, as a batch can throw", () => {
    expect(isUniqueViolation(driverError("duplicate key", "23505"))).toBe(true);
  });

  it("is null for anything that is not a Postgres error", () => {
    expect(pgErrorCode(new Error("network"))).toBeNull();
    expect(pgErrorCode(null)).toBeNull();
    expect(pgErrorCode(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBeNull();
  });
});

describe("raisedBy", () => {
  it("finds a trigger's exception on the cause", () => {
    const wrapped = new DrizzleQueryError("update events ...", [], driverError("entitlement_active_limit", "P0001"));
    expect(raisedBy(wrapped, "entitlement_active_limit")).toBe(true);
    expect(raisedBy(wrapped, "entitlement_monthly_limit")).toBe(false);
  });

  it("is not fooled by the name appearing in the failed SQL", () => {
    const wrapped = new DrizzleQueryError("select entitlement_active_limit from x", [], driverError("other", "P0001"));
    expect(raisedBy(wrapped, "entitlement_active_limit")).toBe(false);
  });
});
