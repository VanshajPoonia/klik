import { defineConfig } from "vitest/config";

/**
 * Test setup for F-7.
 *
 * Deliberately narrow for now: these run in Node with no database and no
 * network, so they cover pure logic only. That is not the whole of F-7. The
 * paths that actually destroy data (the purge cron's circuit breaker,
 * `lib/erasure.ts`, and the co-host revocation predicate in `lib/roles.ts`)
 * need a throwaway Postgres to run against, and until a Neon staging branch
 * exists there is nowhere safe to point them. They are the reason F-7 was
 * moved ahead of ACT-1, so they are not optional, just blocked.
 *
 * What is here is chosen on one rule: cover the things that already went
 * wrong once. SEC-9 (a zip accepted as a JPEG), SEC-10 (a denylist leaking
 * retention fields to guests) and MED-8 (metadata handling) are all regressions
 * waiting to happen again, and each now fails a test instead.
 */
export default defineConfig({
  resolve: {
    alias: { "@": import.meta.dirname },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    /**
     * `lib/env.ts` validates at module load and throws on anything missing,
     * which is the whole point of F-6. Importing almost any module therefore
     * pulls in that check, so tests need a complete fake environment.
     *
     * None of these reach a real service. DATABASE_URL in particular is
     * syntactically valid and points nowhere: `neon-http` builds its client
     * lazily, so importing the schema never opens a connection. Any test that
     * genuinely needs Postgres belongs in the suite that is still blocked on a
     * staging branch, not here.
     */
    env: {
      DATABASE_URL: "postgres://user:pass@127.0.0.1:5432/klik_test",
      AUTH_SECRET: "test-auth-secret-not-used-to-sign-anything-real",
      R2_ACCOUNT_ID: "test-account",
      R2_ACCESS_KEY_ID: "test-access-key",
      R2_SECRET_ACCESS_KEY: "test-secret-key",
      R2_BUCKET_NAME: "klik-media-test",
      APP_URL: "https://example.test",
    },
  },
});
