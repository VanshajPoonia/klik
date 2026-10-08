import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authGet = vi.fn(async () => new Response("auth.js", { status: 302, headers: { Location: "/after-sign-in" } }));
const authPost = vi.fn(async () => Response.json({ url: "http://localhost/login?verify=1" }));

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/auth", () => ({ handlers: { GET: authGet, POST: authPost } }));

const { GET, POST } = await import("@/app/api/auth/[...nextauth]/route");
const { SIGN_IN_CODE_ATTEMPTS } = await import("@/lib/sign-in-code");
const { closeDatabase, resetDatabase } = await import("./harness");

const verify = (email: string, ip = "1.1.1.1") =>
  GET(
    new NextRequest(`http://localhost/api/auth/callback/resend?email=${encodeURIComponent(email)}&token=123456`, {
      headers: { "x-forwarded-for": ip },
    }),
  );
const send = (email: string, ip = "1.1.1.1") =>
  POST(
    new NextRequest("http://localhost/api/auth/signin/resend", {
      method: "POST",
      body: new URLSearchParams({ email, csrfToken: "x" }),
      headers: { "Content-Type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
    }),
  );

beforeEach(async () => {
  authGet.mockClear();
  authPost.mockClear();
  await resetDatabase();
});

afterAll(closeDatabase);

describe("ACC-2 code limits", () => {
  it("stops guessing at one address after a handful of tries, whatever its casing", async () => {
    for (let i = 0; i < SIGN_IN_CODE_ATTEMPTS; i += 1) {
      expect((await verify(i % 2 ? "Ana@Example.com" : "ana@example.com")).status).toBe(302);
    }
    const blocked = await verify("ANA@example.com");
    expect(blocked.status).toBe(303);
    expect(blocked.headers.get("location")).toContain("/login?error=TooManyAttempts");
    expect(authGet).toHaveBeenCalledTimes(SIGN_IN_CODE_ATTEMPTS);
  });

  it("counts each address separately", async () => {
    for (let i = 0; i < SIGN_IN_CODE_ATTEMPTS; i += 1) await verify("ana@example.com");
    expect((await verify("bo@example.com")).status).toBe(302);
  });

  it("limits how often one address can be sent a code", async () => {
    for (let i = 0; i < 3; i += 1) await send("ana@example.com");
    const blocked = await send("ana@example.com");
    expect(await blocked.json()).toEqual({ url: "http://localhost/login?error=TooManyAttempts" });
    expect(authPost).toHaveBeenCalledTimes(3);
  });

  it("passes everything else straight through", async () => {
    const response = await GET(new NextRequest("http://localhost/api/auth/session"));
    expect(response.status).toBe(302);
    expect(authGet).toHaveBeenCalledTimes(1);
  });
});
