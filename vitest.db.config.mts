import { defineConfig } from "vitest/config";

/**
 * The database half of F-7, kept as a separate command from `npm test`.
 *
 * These need a running Postgres, so they are opt-in: a contributor without one
 * still gets a green `npm test` rather than a wall of connection errors, and
 * CI can run both. Start the database with `scripts/test-db.sh`.
 */
export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    environment: "node",
    include: ["test/**/*.dbtest.ts"],
    // Every file truncates the whole database, so they cannot overlap.
    fileParallelism: false,
    env: {
      DATABASE_URL: "postgres://user:pass@127.0.0.1:5432/klik_unused",
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55433/klik_test",
      CRON_SECRET: "test-cron-secret",
      AUTH_SECRET: "test-auth-secret-not-used-to-sign-anything-real",
      R2_ACCOUNT_ID: "test-account",
      R2_ACCESS_KEY_ID: "test-access-key",
      R2_SECRET_ACCESS_KEY: "test-secret-key",
      R2_BUCKET_NAME: "klik-media-test",
      APP_URL: "https://example.test",
    },
  },
});
