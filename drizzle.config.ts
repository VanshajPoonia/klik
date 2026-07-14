import { defineConfig } from "drizzle-kit";

// drizzle-kit runs standalone (outside Next.js's own env loading), so load
// .env.local explicitly. Node 20.6+ supports this without extra dependencies.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local present (e.g. in CI where vars are injected directly) - fine.
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

export default defineConfig({
  schema: "./lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
