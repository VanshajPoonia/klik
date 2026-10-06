import { z } from "zod";
import { generateUsername } from "./credentials";

/**
 * Self-serve signup, the parts that are pure.
 *
 * Kept apart from the route so the rules can be tested without a database, a
 * session or a mail provider. Everything here is a decision about what a valid
 * account looks like; the route is the part with side effects.
 */

/**
 * The lowest length that is worth enforcing, and the highest that is honest.
 *
 * 10 rather than 8 because this password is the only thing between a stranger
 * and an organizer's gallery, and the login form is rate limited but public.
 * 72 because bcrypt hashes the first 72 BYTES and silently ignores the rest, so
 * accepting a 200-character passphrase would quietly store a shorter secret than
 * the person believes they chose.
 */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 72;

/**
 * Lowercased and trimmed, and nothing else.
 *
 * Specifically NOT stripping dots or `+tag` suffixes. That normalisation is a
 * Gmail convention, not a rule of email, and applying it generally means
 * `first.last@company.com` and `firstlast@company.com` collapse into one account
 * at providers where they are two different people.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * A login name for an account that was created by email.
 *
 * The Credentials provider looks accounts up by `users.username`, and the admin
 * path has always generated one. Deriving it from the email local part keeps
 * both kinds of account the same shape, so nothing downstream has to ask which
 * way an account came into being. The random suffix comes from
 * `generateUsername`, which is also what makes two people at the same company
 * not collide.
 */
export function usernameFromEmail(email: string): string {
  const localPart = normalizeEmail(email).split("@")[0] ?? "";
  return generateUsername(localPart);
}

/**
 * Whether a password merely restates the address it protects.
 *
 * `daniel@venue.com` with the password `daniel2024` is the case this catches. It
 * passes a length check and it is the first thing anyone guesses.
 */
export function passwordRestatesEmail(password: string, email: string): boolean {
  const localPart = normalizeEmail(email).split("@")[0] ?? "";
  if (localPart.length < 4) return false;
  return password.toLowerCase().includes(localPart);
}

export const signupSchema = z
  .object({
    name: z.string().trim().min(1, "Tell us your name").max(120),
    email: z
      .string()
      .trim()
      .min(3)
      .max(254)
      .email("That does not look like an email address")
      .transform(normalizeEmail),
    password: z
      .string()
      .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
      .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`),
  })
  .refine((value) => !passwordRestatesEmail(value.password, value.email), {
    message: "Choose a password that is not part of your email address",
    path: ["password"],
  });

export type SignupInput = z.infer<typeof signupSchema>;
