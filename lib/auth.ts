import NextAuth, { CredentialsSignin } from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { users, accounts, sessions, verificationTokens, type UserRole } from "./schema";
import { verifyPassword } from "./credentials";
import { clientIp, consume } from "./ratelimit";
import { env } from "./env";
import { SIGN_IN_CODE_MINUTES, generateSignInCode, sendSignInCode } from "./sign-in-code";
import { usernameFromEmail } from "./signup";
import { isUniqueViolation, raisedBy } from "./db-errors";
import { reportError } from "./observability";
import { authorizePasskey } from "./passkeys";

/** ACC-6: why a passkey sign-in failed, as the code next-auth/react hands back. */
class PasskeyUnknown extends CredentialsSignin {
  code = "passkey_unknown";
}
class PasskeyExpired extends CredentialsSignin {
  code = "passkey_expired";
}
class PasskeyRefused extends CredentialsSignin {
  code = "passkey_refused";
}

const oauthProviders = [];
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  oauthProviders.push(Google);
}
// Both, not just the key. A hard-coded fallback sender was here and was wrong:
// it read `no-reply@klik.kreativvantage.com` while the domain actually verified
// in Resend is the `mail.` subdomain, as .env.example has said all along. Resend
// refuses any unverified domain, so that fallback did not provide a default, it
// provided a "Continue with email" button that fails every single time and
// reports it as a bad key rather than a bad sender.
//
// There is no correct address to guess, so the provider is simply not offered
// until someone names one. Same reasoning as `sender()` in lib/email.ts.
if (process.env.AUTH_RESEND_KEY && env.AUTH_EMAIL_FROM) {
  // ACC-2: the email carries a six-digit code as well as the link, so it can be
  // typed into the tab that asked for it. Short-lived, because the space is
  // small; the guesses are counted in the route wrapper.
  oauthProviders.push(
    Resend({
      from: env.AUTH_EMAIL_FROM,
      maxAge: SIGN_IN_CODE_MINUTES * 60,
      generateVerificationToken: generateSignInCode,
      sendVerificationRequest: ({ identifier, url, token }) => sendSignInCode({ to: identifier, code: token, url }),
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  // Credentials sign-in always issues a JWT-encoded cookie (never a DB session
  // row), regardless of this setting. Reading a session back branches purely
  // on this global setting, so "database" here would make credential logins
  // look logged-out on the very next request. JWT is required, not a choice.
  session: { strategy: "jwt" },
  providers: [
    ...oauthProviders,
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const username = credentials?.username;
        const password = credentials?.password;
        if (typeof username !== "string" || typeof password !== "string") return null;

        // Throttle before touching the database or bcrypt. This form guards the
        // superadmin account, and a cost-12 hash is expensive enough that an
        // unthrottled endpoint is a CPU exhaustion vector on its own, quite
        // apart from being an open door for credential stuffing.
        // Both buckets matter: per-IP stops one host spraying many usernames,
        // per-username stops a botnet converging on one account.
        const ip = clientIp(request as unknown as Request);
        const [byIp, byUser] = await Promise.all([
          consume(`login:ip:${ip}`, 10, 15 * 60),
          consume(`login:user:${username.toLowerCase()}`, 5, 15 * 60),
        ]);
        if (!byIp.allowed || !byUser.allowed) {
          // Indistinguishable from a wrong password by design, so probing
          // cannot be used to discover which usernames exist.
          console.warn(`Credential login throttled for ${ip}`);
          return null;
        }

        // Two kinds of account sign in through this one form. A superadmin or a
        // venue set up at /admin/new has a generated username and no email; a
        // self-serve signup has both, and will type the email it chose, because
        // that is the only identifier it was ever shown.
        //
        // Branching on "@" rather than matching either column keeps the lookup
        // unambiguous. An OR across two unique columns can match two different
        // rows, and then which one authenticates depends on row order.
        const identifier = username.trim();
        const [user] = await db
          .select()
          .from(users)
          .where(
            identifier.includes("@")
              ? sql`lower(${users.email}) = ${identifier.toLowerCase()}`
              // Without case, as the unique index since 0027 is, so "Anita"
              // signs in as the account it could not have been created beside.
              : sql`lower(${users.username}) = ${identifier.toLowerCase()}`,
          )
          .limit(1);
        // No hash means this account has no password to check: an account created
        // through Google or a sign-in link. Returning null rather than falling
        // through is what stops a credential attempt from being a way in to one.
        if (!user?.passwordHash) return null;

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
          username: user.username,
          credentialVersion: user.credentialVersion,
        };
      },
    }),
    // ACC-6: a passkey. The phone has already checked the face or finger; this
    // checks the phone's signature over a challenge only this server issued.
    Credentials({
      id: "passkey",
      name: "Passkey",
      credentials: { response: { type: "text" } },
      async authorize(credentials, request) {
        const result = await authorizePasskey(credentials?.response, request as unknown as Request);
        if (!result.ok) {
          // An unknown passkey is one removed from the account but still on
          // the phone. Saying so lets the page ask the phone to forget it.
          if (result.reason === "unknown") throw new PasskeyUnknown();
          if (result.reason === "expired") throw new PasskeyExpired();
          if (result.reason === "invalid") throw new PasskeyRefused();
          return null;
        }
        const { user } = result;
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
          username: user.username,
          credentialVersion: user.credentialVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role ?? "organizer";
        token.username = user.username ?? null;
        token.credentialVersion = user.credentialVersion;
        return token;
      }

      if (typeof token.username === "string" && typeof token.id === "string") {
        const [currentUser] = await db
          .select({ credentialVersion: users.credentialVersion, username: users.username })
          .from(users)
          .where(eq(users.id, token.id))
          .limit(1);
        if (
          !currentUser ||
          typeof token.credentialVersion !== "number" ||
          currentUser.credentialVersion !== token.credentialVersion
        ) {
          return null;
        }
        // ID-2: a handle can change mid-session. The row is read here anyway,
        // so the token follows it rather than naming the old one until expiry.
        token.username = currentUser.username;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string | undefined) ?? (token.sub as string | undefined) ?? "";
        session.user.role = (token.role as UserRole | undefined) ?? "organizer";
        session.user.username = (token.username as string | null | undefined) ?? null;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    // A wrong or expired code lands back on the form that can say so, rather
    // than on Auth.js's own error page, which looks like a different site.
    error: "/login",
  },
  events: {
    // ACC-2 and ID-1: an account made by a code or by Google gets a handle
    // like every other account, so nothing downstream asks how it was made.
    async createUser({ user }) {
      if (!user.id || !user.email) return;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await db
            .update(users)
            .set({ username: usernameFromEmail(user.email) })
            .where(sql`${users.id} = ${user.id} AND ${users.username} IS NULL`);
          return;
        } catch (error) {
          if (!isUniqueViolation(error) && !raisedBy(error, "username_reserved")) {
            reportError("auth.username_on_create_failed", error);
            return;
          }
        }
      }
    },
  },
});
