import type { DefaultSession } from "next-auth";
import type { UserRole } from "@/lib/schema";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      username: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role?: UserRole;
    username?: string | null;
    credentialVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: UserRole;
    username?: string | null;
    credentialVersion?: number;
  }
}
