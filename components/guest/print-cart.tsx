"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Minus, Plus, Printer, X } from "lucide-react";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { useGuestCopy } from "@/components/guest/guest-copy";
import { MAX_COPIES, MAX_ORDER_LINES, PRINT_PRODUCTS, SHIPPING_CENTS, productByKey } from "@/lib/print-catalog";

/**
 * GRW-6: the guest's prints, kept on this phone per gallery until they pay
 * (localStorage, so a reload or a closed tab loses nothing), and the sheet
 * that sends them to Stripe's checkout. Prices shown here are for show: the
 * server prices every line again from its own list.
 */

export interface CartLine {
  mediaId: string;
  product: string;
  copies: number;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function usePrintCart(eventId: string) {
  const key = `klik_prints_${eventId}`;
  const [lines, setLines] = useState<CartLine[]>([]);

  useEffect(() => {
    let saved: CartLine[] = [];
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) saved = (JSON.parse(raw) as CartLine[]).filter((line) => productByKey(line.product) && line.copies > 0);
    } catch {
      // Storage blocked or garbled: start empty.
    }
    if (saved.length > 0) {
      const timer = window.setTimeout(() => setLines(saved), 0);
      return () => window.clearTimeout(timer);
    }
  }, [key]);

  const save = useCallback(
    (next: CartLine[]) => {
      setLines(next);
      try {
        if (next.length === 0) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Kept for this visit only.
      }
    },
    [key],
  );

  /** Adds copies of one size of one photo, merging with what is there. Returns the new count. */
  const add = useCallback(
    (mediaId: string, product: string, copies: number): number => {
      const next = [...lines];
      const existing = next.find((line) => line.mediaId === mediaId && line.product === product);
      if (existing) existing.copies = Math.min(MAX_COPIES, existing.copies + copies);
      else if (next.length < MAX_ORDER_LINES) next.push({ mediaId, product, copies: Math.min(MAX_COPIES, copies) });
      save(next);
      return next.reduce((total, line) => total + line.copies, 0);
    },
    [lines, save],
  );

  const update = useCallback(
    (index: number, change: Partial<CartLine>) => {
      const next = lines.map((line, at) => (at === index ? { ...line, ...change } : line)).filter((line) => line.copies > 0);
      save(next);
    },
    [lines, save],
  );

  const clear = useCallback(() => save([]), [save]);
  const count = lines.reduce((total, line) => total + line.copies, 0);
  return { lines, add, update, clear, count };
}

export function PrintCartSheet({
  slug,
  cart,
  thumbs,
  onClose,
}: {
  slug: string;
  cart: ReturnType<typeof usePrintCart>;
  /** The tile to show for each photo, when the gallery has it loaded. */
  thumbs: Map<string, string | null>;
  onClose: () => void;
}) {
  const { t, locale } = useGuestCopy();
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const [email, setEmail] = useState("");
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subtotal = cart.lines.reduce((total, line) => total + (productByKey(line.product)?.priceCents ?? 0) * line.copies, 0);

  async function pay(event: FormEvent) {
    event.preventDefault();
    setPaying(true);
    setError(null);
    const response = await fetch(`/api/e/${slug}/prints`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines: cart.lines, email: email.trim() || undefined, locale }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!response?.ok || !body.url) {
      setPaying(false);
      setError(body?.error ?? t.prints.failed);
      return;
    }
    // The cart stays until the order page says it was paid, so a cancelled
    // checkout comes back to the same prints.
    window.location.assign(body.url);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="print-cart-heading"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-canvas-line bg-canvas p-5 sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="print-cart-heading" className="flex items-center gap-2 font-display text-xl text-paper">
            <Printer className="h-5 w-5 text-volt" aria-hidden="true" />
            {t.prints.cart}
          </h2>
          <button type="button" onClick={onClose} aria-label={t.prints.close} className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:text-paper">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {cart.lines.length === 0 ? (
          <p className="text-sm text-muted">{t.prints.empty}</p>
        ) : (
          <form onSubmit={pay} className="space-y-4">
            <ul className="divide-y divide-canvas-line">
              {cart.lines.map((line, index) => {
                const thumb = thumbs.get(line.mediaId);
                const product = productByKey(line.product)!;
                return (
                  <li key={`${line.mediaId}:${line.product}`} className="flex items-center gap-3 py-3">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-canvas-line bg-canvas-raised">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a signed tile URL */}
                      {thumb && <img src={thumb} alt="" className="h-full w-full object-cover" />}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <select
                        aria-label={t.prints.chooseSize}
                        value={line.product}
                        onChange={(event) => cart.update(index, { product: event.target.value })}
                        className="min-h-9 rounded-full border border-canvas-line bg-canvas-raised px-3 text-sm text-paper"
                      >
                        {PRINT_PRODUCTS.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label} · {money(option.priceCents)}
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center gap-1">
                        <button type="button" aria-label={t.prints.fewer} onClick={() => cart.update(index, { copies: line.copies - 1 })} className="flex h-9 w-9 items-center justify-center rounded-full border border-canvas-line text-paper">
                          <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <span className="w-8 text-center text-sm tabular-nums text-paper" aria-label={t.prints.copies}>
                          {line.copies}
                        </span>
                        <button type="button" aria-label={t.prints.more} disabled={line.copies >= MAX_COPIES} onClick={() => cart.update(index, { copies: line.copies + 1 })} className="flex h-9 w-9 items-center justify-center rounded-full border border-canvas-line text-paper disabled:opacity-40">
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => cart.update(index, { copies: 0 })} className="ml-2 min-h-9 px-2 text-xs text-muted hover:text-paper">
                          {t.prints.remove}
                        </button>
                      </div>
                    </div>
                    <p className="text-sm tabular-nums text-paper">{money(product.priceCents * line.copies)}</p>
                  </li>
                );
              })}
            </ul>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between text-muted">
                <dt>{t.prints.shipping}</dt>
                <dd className="tabular-nums">{money(SHIPPING_CENTS)}</dd>
              </div>
              <div className="flex justify-between font-medium text-paper">
                <dt>{t.prints.total}</dt>
                <dd className="tabular-nums">{money(subtotal + SHIPPING_CENTS)}</dd>
              </div>
            </dl>
            <label className="block space-y-1 text-sm">
              <span className="text-muted">{t.prints.email}</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                inputMode="email"
                maxLength={254}
                className="h-11 w-full rounded-full border border-canvas-line bg-canvas-raised px-4 text-sm text-paper focus-visible:border-volt focus-visible:outline-none"
              />
            </label>
            <p className="text-xs text-muted">{t.prints.note}</p>
            {error && (
              <p className="text-sm text-red-400" role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={paying} className="min-h-11 w-full rounded-full bg-volt px-5 text-sm font-medium text-on-volt transition-transform active:scale-95 disabled:opacity-50">
              {paying ? t.prints.paying : t.prints.pay}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
