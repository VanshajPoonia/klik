import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { users } from "../lib/schema";
import { hashPassword } from "../lib/credentials";

async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local present, so assume the caller set env vars directly.
  }

  const username = process.env.SUPERADMIN_USERNAME;
  const password = process.env.SUPERADMIN_PASSWORD;
  const name = process.env.SUPERADMIN_NAME || "Klik Admin";

  if (!username || !password) {
    console.error(
      "Set SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD before running this script.",
    );
    process.exit(1);
  }

  // Deferred until after env is loaded, because lib/db throws at import time if
  // DATABASE_URL isn't set yet.
  const { db } = await import("../lib/db");

  const passwordHash = await hashPassword(password);
  const [existing] = await db.select().from(users).where(eq(users.username, username)).limit(1);

  if (existing) {
    await db
      .update(users)
      .set({ passwordHash, role: "superadmin", name })
      .where(eq(users.id, existing.id));
    console.log(`Updated existing superadmin "${username}".`);
  } else {
    await db.insert(users).values({
      id: nanoid(),
      name,
      role: "superadmin",
      username,
      passwordHash,
    });
    console.log(`Created superadmin "${username}".`);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
