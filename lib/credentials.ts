import bcrypt from "bcryptjs";
import { customAlphabet } from "nanoid";

// Account login credentials (superadmin/venue) guard access to moderation,
// deletion, and settings - higher stakes than a gallery view-password, so a
// higher cost than the cost-10 convention used for event gallery passwords.
const ACCOUNT_PASSWORD_COST = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ACCOUNT_PASSWORD_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Excludes visually ambiguous characters (0/O, 1/l/I) since these are handed off
// to venues by a sales rep and typed in once on a phone.
const USERNAME_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const PASSWORD_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";

const usernameSuffix = customAlphabet(USERNAME_ALPHABET, 4);
const passwordChars = customAlphabet(PASSWORD_ALPHABET, 12);

export function slugifyUsername(seed: string): string {
  const base = seed
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 24);
  return base || "client";
}

export function generateUsername(seed: string): string {
  return `${slugifyUsername(seed)}.${usernameSuffix()}`;
}

export function generatePassword(): string {
  return passwordChars();
}
