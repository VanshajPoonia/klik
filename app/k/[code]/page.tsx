import type { Metadata } from "next";
import { auth, signOut } from "@/lib/auth";
import { buttonClassName } from "@/components/ui/button";
import { findPairing } from "@/lib/kiosks";
import { KioskPairing } from "@/components/kiosk/kiosk-pairing";

export const metadata: Metadata = { title: "Set up a kiosk", robots: { index: false } };

/**
 * VEN-2: where a pairing link lands. It only shows what the link is for; the
 * code is spent by the button, so a chat app previewing the link spends
 * nothing.
 */
export default async function KioskPairingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const pairing = await findPairing(code);
  if (!pairing) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 text-center">
        <h1 className="font-display text-2xl text-paper">This link has been used or has expired.</h1>
        <p className="mt-3 max-w-sm text-sm text-muted">
          A kiosk link works once, for thirty minutes. Make a new one from the event&apos;s QR code tab.
        </p>
      </main>
    );
  }
  const session = await auth();
  return (
    <KioskPairing
      code={code}
      eventName={pairing.eventName}
      kioskName={pairing.kioskName}
      signedInAs={session?.user ? (session.user.email ?? session.user.name ?? "an account") : null}
      signOut={
        // Back to this page afterwards: the code is spent by the button, not
        // by opening the link, so it still works.
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: `/k/${code}` });
          }}
        >
          <button className={buttonClassName({ variant: "ghost", size: "sm" })}>Sign out of this device</button>
        </form>
      }
    />
  );
}
