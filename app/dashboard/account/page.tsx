import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { availableSuggestions } from "@/lib/account";
import { USERNAME_CHANGE_DAYS } from "@/lib/username";
import { Card } from "@/components/ui/card";
import { ProfileForm } from "@/components/account/profile-form";
import { UsernameForm } from "@/components/account/username-form";
import { PasswordForm } from "@/components/account/password-form";
import { DeleteAccount } from "@/components/account/delete-account";
import { PasskeysCard } from "@/components/account/passkeys-card";
import { listPasskeys } from "@/lib/passkeys";
import { isoBase64URL } from "@simplewebauthn/server/helpers";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

/** ID-2 and the account's own settings: name, handle, password, passkeys (ACC-6), and leaving. */
export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/dashboard/account");

  const [account] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      username: users.username,
      usernameChangedAt: users.usernameChangedAt,
      // Decided by the database's clock, as the change itself is.
      canChangeUsername: sql<boolean>`${users.usernameChangedAt} IS NULL OR ${users.usernameChangedAt} <= now() - (${USERNAME_CHANGE_DAYS}::int * interval '1 day')`,
      hasPassword: sql<boolean>`${users.passwordHash} IS NOT NULL`,
      role: users.role,
      // The page's clock, for "last used 2h ago", taken from the database so
      // rendering stays pure.
      now: sql<string>`now()`,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!account) redirect("/login");

  const { canChangeUsername } = account;
  const nextChangeAt = account.usernameChangedAt
    ? new Date(account.usernameChangedAt.getTime() + USERNAME_CHANGE_DAYS * 86_400_000)
    : null;
  // Offered only to someone still on the handle Klik generated for them.
  const [suggestions, passkeys] = await Promise.all([
    !account.usernameChangedAt && canChangeUsername
      ? availableSuggestions(account.id, account.name, account.email)
      : Promise.resolve([]),
    listPasskeys(account.id),
  ]);

  return (
    <div className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-2xl">
        <Link
          href={account.role === "superadmin" ? "/admin" : "/dashboard"}
          className="mb-6 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted transition-colors hover:text-paper"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Link>
        <h1 className="font-display text-2xl text-paper">Your account</h1>
        {account.email && <p className="mt-1 text-sm text-muted">{account.email}</p>}

        <div className="mt-8 space-y-5">
          <Card>
            <ProfileForm initialName={account.name ?? ""} />
          </Card>
          <Card>
            <UsernameForm
              initialUsername={account.username}
              canChange={canChangeUsername}
              nextChangeAt={canChangeUsername ? null : (nextChangeAt?.toISOString() ?? null)}
              suggestions={suggestions}
            />
          </Card>
          {account.hasPassword && (
            <Card>
              <PasswordForm signInAs={account.email ?? account.username ?? ""} />
            </Card>
          )}
          <Card>
            <PasskeysCard initial={passkeys} userHandle={isoBase64URL.fromUTF8String(account.id)} now={new Date(account.now).getTime()} />
          </Card>
          {account.role !== "superadmin" && (
            <Card>
              <DeleteAccount confirmWith={account.username ?? account.email ?? ""} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
