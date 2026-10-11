import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, media, printOrders } from "@/lib/schema";
import { confirmPayment, productByKey, verifyOrderKey } from "@/lib/prints";
import { signObjectUrl } from "@/lib/media-urls";
import { reportError } from "@/lib/observability";
import { ClearPrintCart } from "@/components/guest/clear-print-cart";

export const metadata: Metadata = {
  title: "Your prints",
  robots: { index: false, follow: false },
};

const COPY = {
  en: {
    awaiting_payment: ["Waiting for your payment", "If you just paid, this page updates in a moment. Reload it if it does not."],
    paid: ["Your prints are ordered", "A person at Klik checks every order before it goes to the printer, usually within a day. Then it takes about a week to print and ship. We will email you when they are on their way."],
    submitted: ["At the printer", "Your prints are being made. We will email you when they ship."],
    shipped: ["On their way", "Your prints have shipped and usually arrive within a week."],
    refunded: ["Refunded", "We could not print this order and refunded you in full. It usually shows on your card within a few days."],
    cancelled: ["Cancelled", "This order was cancelled. If you were charged, we will refund you; write to us if you have questions."],
    expired: ["This checkout expired", "Nothing was charged. You can order again from the gallery."],
    failed: ["Something went wrong", "We are looking at it. If you were charged and it does not ship, we will refund you."],
    copies: (n: number) => `${n} ${n === 1 ? "copy" : "copies"}`,
    subtotal: "Prints",
    shipping: "Shipping",
    tax: "Tax",
    total: "Total",
    track: "Track them",
    back: "Back to the gallery",
  },
  es: {
    awaiting_payment: ["Esperando tu pago", "Si acabas de pagar, esta página se actualiza en un momento. Recárgala si no."],
    paid: ["Tus impresiones están pedidas", "Una persona de Klik revisa cada pedido antes de enviarlo a la imprenta, normalmente en un día. Luego tarda una semana en imprimirse y enviarse. Te escribiremos cuando vayan en camino."],
    submitted: ["En la imprenta", "Tus impresiones se están haciendo. Te escribiremos cuando se envíen."],
    shipped: ["En camino", "Tus impresiones ya salieron y suelen llegar en una semana."],
    refunded: ["Reembolsado", "No pudimos imprimir este pedido y te devolvimos todo. Suele verse en tu tarjeta en unos días."],
    cancelled: ["Cancelado", "Este pedido se canceló. Si se te cobró, te lo devolveremos; escríbenos si tienes preguntas."],
    expired: ["Este pago caducó", "No se cobró nada. Puedes pedir de nuevo desde la galería."],
    failed: ["Algo salió mal", "Lo estamos revisando. Si se te cobró y no se envía, te lo devolveremos."],
    copies: (n: number) => `${n} ${n === 1 ? "copia" : "copias"}`,
    subtotal: "Impresiones",
    shipping: "Envío",
    tax: "Impuestos",
    total: "Total",
    track: "Seguir el envío",
    back: "Volver a la galería",
  },
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * GRW-6: the buyer's order, reached from Stripe's return and from every
 * email. The key in the link is what opens it, since a buyer may have no
 * account and may have ordered on a venue's own domain.
 */
export default async function PrintOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ k?: string; session_id?: string; l?: string }>;
}) {
  const { orderId } = await params;
  const { k, session_id: sessionId, l } = await searchParams;
  if (!verifyOrderKey(orderId, k ?? null)) notFound();
  const copy = COPY[l === "es" ? "es" : "en"];

  let [order] = await db.select().from(printOrders).where(eq(printOrders.id, orderId)).limit(1);
  if (!order) notFound();
  // Back from Stripe: ask Stripe, never the browser, whether it was paid.
  if (order.status === "awaiting_payment" && sessionId && sessionId === order.stripeSessionId) {
    order = (await confirmPayment(order.id).catch((error) => {
      reportError("prints.confirm_failed", error, { orderId });
      return order;
    })) ?? order;
  }

  const [rows, event] = await Promise.all([
    db.select().from(media).where(inArray(media.id, order.items.map((item) => item.mediaId))),
    order.eventId ? db.select({ name: events.name, slug: events.slug }).from(events).where(eq(events.id, order.eventId)).limit(1) : Promise.resolve([]),
  ]);
  const thumbs = await signThumbs(order.items, rows);
  const [heading, body] = copy[order.status];
  const tracking = order.tracking?.find((entry) => entry.url);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col px-4 py-16">
      {order.eventId && order.status !== "awaiting_payment" && order.status !== "expired" && <ClearPrintCart eventId={order.eventId} />}
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Klik prints{event[0] ? ` · ${event[0].name}` : ""}</p>
      <h1 className="mt-3 font-display text-3xl text-paper">{heading}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">{body}</p>
      {tracking?.url && (
        <a href={tracking.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 w-fit items-center rounded-full bg-volt px-5 text-sm font-medium text-on-volt">
          {copy.track}
        </a>
      )}

      <ul className="mt-8 divide-y divide-canvas-line rounded-2xl border border-canvas-line bg-canvas-raised">
        {order.items.map((item, index) => (
          <li key={`${item.mediaId}:${item.product}`} className="flex items-center gap-3 p-3">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-canvas-line bg-canvas">
              {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived URL */}
              {thumbs[index] && <img src={thumbs[index]!} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-paper">{productByKey(item.product)?.label ?? item.product}</p>
              <p className="text-muted">{copy.copies(item.copies)}</p>
            </div>
            <p className="text-sm tabular-nums text-paper">{money(item.unitCents * item.copies)}</p>
          </li>
        ))}
      </ul>
      <dl className="mt-4 space-y-1 text-sm">
        <div className="flex justify-between text-muted"><dt>{copy.subtotal}</dt><dd className="tabular-nums">{money(order.subtotalCents)}</dd></div>
        <div className="flex justify-between text-muted"><dt>{copy.shipping}</dt><dd className="tabular-nums">{money(order.shippingCents)}</dd></div>
        {order.taxCents > 0 && (
          <div className="flex justify-between text-muted"><dt>{copy.tax}</dt><dd className="tabular-nums">{money(order.taxCents)}</dd></div>
        )}
        <div className="flex justify-between font-medium text-paper"><dt>{copy.total}</dt><dd className="tabular-nums">{money(order.totalCents)}</dd></div>
      </dl>

      {event[0] && (
        <Link href={`/e/${event[0].slug}`} className="mt-10 text-sm text-paper underline underline-offset-2">
          {copy.back}
        </Link>
      )}
    </main>
  );
}

/** One signed tile per line, or null for a photo deleted since. */
async function signThumbs(
  items: Array<{ mediaId: string }>,
  rows: Array<{ id: string; deletedAt: Date | null; thumbPathname: string | null; blobPathname: string }>,
): Promise<Array<string | null>> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const now = Date.now();
  return Promise.all(
    items.map(async (item) => {
      const row = byId.get(item.mediaId);
      const key = row && !row.deletedAt ? (row.thumbPathname ?? row.blobPathname) : null;
      return key ? signObjectUrl(key, "image/jpeg", now) : null;
    }),
  );
}
