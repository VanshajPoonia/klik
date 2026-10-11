"use client";

import { useEffect } from "react";

/** GRW-6: once an order is paid, the prints it came from leave the phone's cart. */
export function ClearPrintCart({ eventId }: { eventId: string }) {
  useEffect(() => {
    try {
      window.localStorage.removeItem(`klik_prints_${eventId}`);
    } catch {
      // Storage blocked: nothing was kept.
    }
  }, [eventId]);
  return null;
}
