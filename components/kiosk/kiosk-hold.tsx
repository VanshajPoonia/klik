"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** VEN-2: what a kiosk shows when it cannot take photos, checking again each minute. */
export function KioskHold({ title, detail, recheck }: { title: string; detail: string; recheck: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!recheck) return;
    const timer = window.setInterval(() => router.refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [recheck, router]);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-8 text-center">
      <h1 className="max-w-2xl font-display text-4xl text-paper">{title}</h1>
      <p className="mt-4 max-w-md text-lg text-muted">{detail}</p>
    </main>
  );
}
