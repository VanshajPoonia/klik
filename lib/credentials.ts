import bcrypt from "bcryptjs";
import { customAlphabet } from "nanoid";
import { usernameStem } from "./username";

// Account login credentials (superadmin/venue) guard access to moderation,
// deletion, and settings. That is higher stakes than a gallery view-password, so a
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

/**
 * A generated handle that already follows ID-1's rules, so an account made by
 * signup or by the admin quick-create never needs grandfathering: a stem of at
 * most 15 characters, an underscore, and four characters nobody misreads.
 */
export function slugifyUsername(seed: string): string {
  return usernameStem(seed, 15) || "client";
}

export function generateUsername(seed: string): string {
  return `${slugifyUsername(seed)}_${usernameSuffix()}`;
}

export function generatePassword(): string {
  return passwordChars();
}
