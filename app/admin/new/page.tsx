import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { QuickCreateForm } from "@/components/admin/quick-create-form";

export default async function NewClientPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "superadmin") redirect("/dashboard");

  return (
    <div className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-xl">
        <div className="mb-6">
          <Link href="/admin" className="text-sm text-muted hover:text-paper">
            ← All clients
          </Link>
        </div>
        <h1 className="mb-2 font-display text-2xl text-paper">Provision a new client</h1>
        <p className="mb-8 text-sm text-muted">
          Creates a login and an event in one step. Hand off the username, password, and QR code
          to the venue.
        </p>
        <QuickCreateForm />
      </div>
    </div>
  );
}
