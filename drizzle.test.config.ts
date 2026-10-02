import { defineConfig } from "drizzle-kit";

/**
 * Points drizzle-kit at the throwaway Postgres used by the database tests.
 * Separate from drizzle.config.ts specifically so a mistyped command cannot
 * push a schema change at production: this config has no fallback and fails
 * when TEST_DATABASE_URL is unset.
 */
if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL is not set. Run scripts/test-db.sh first.");
}

export default defineConfig({
  schema: "./lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.TEST_DATABASE_URL },
  strict: false,
  verbose: false,
});
