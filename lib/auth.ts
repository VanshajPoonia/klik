import NextAuth from "next-auth";
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

const oauthProviders = [];
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  oauthProviders.push(Google);
}
if (process.env.AUTH_RESEND_KEY) {
  // Was hard-coded to no-reply@klik.app, a domain this project does not own.
  // Resend refuses to send from an unverified domain, so every magic link would
  // have failed the moment a key was added, and it would have looked like the
  // key was wrong rather than the sender.
  oauthProviders.push(
    Resend({ from: env.AUTH_EMAIL_FROM ?? "Klik <no-reply@klik.kreativvantage.com>" }),
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
              : eq(users.username, identifier),
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
          .select({ credentialVersion: users.credentialVersion })
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
  },
});
