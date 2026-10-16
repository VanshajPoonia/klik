import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type Stripe from "stripe";
import { db } from "./db";
import { events, media, printOrders, type Event, type PrintOrder, type PrintOrderItem, type PrintRecipient } from "./schema";
import { getStripe } from "./stripe";
import { getAppUrl } from "./env";
import { canViewMedia } from "./media-access";
import { isLockedProof } from "./proofs";
import { signObjectUrl } from "./media-urls";
import { sendEmail } from "./email";
import { noticeEmail } from "./emails/notice";
import {
  chooseAttributes,
  createOrder,
  getOrder,
  getProduct,
  isProdigiConfigured,
  prodigiIsLive,
  quote,
  trackingOf,
  type ProdigiAddress,
} from "./prodigi";
import { log, reportError } from "./observability";
import { MAX_COPIES, MAX_ORDER_LINES, PREFERRED_ATTRIBUTES, PRINT_PRODUCTS, REDACT_AFTER_DAYS, SHIPPING_CENTS, productByKey, type PrintProduct } from "./print-catalog";

/**
 * GRW-6: prints from the gallery.
 *
 * **Money, the BILLING.md way.** A guest pays on Stripe's hosted checkout,
 * and Klik records the payment only after asking Stripe itself (never from
 * the browser's word). Nothing is printed automatically: a paid order waits
 * on `/admin` for a person to send it to Prodigi or refund it, exactly as no
 * payment grants a plan by itself. The person sees what Prodigi will charge
 * before sending, and every photo, so a stolen card or a photo that should
 * not be printed stops there. The webhook stays unused: the return page, the
 * admin queue and a daily reconcile each ask Stripe.
 *
 * **What a print is of.** Only a photo the buyer could download: the event's
 * team, or a joined guest when downloads are on (or it is their own). Never a
 * locked proof, whose stored bytes carry the watermark.
 */

export {
  MAX_COPIES,
  MAX_ORDER_LINES,
  PREFERRED_ATTRIBUTES,
  PRINT_PRODUCTS,
  REDACT_AFTER_DAYS,
  SHIPPING_CENTS,
  printDpi,
  printQuality,
  productByKey,
  type PrintProduct,
} from "./print-catalog";

/** The SKU Prodigi is asked for: the catalogue's, unless the environment overrides it. */
export function skuOf(product: Pick<PrintProduct, "key" | "sku">): string {
  return process.env[`PRODIGI_SKU_${product.key.toUpperCase()}`] || product.sku;
}

/**
 * Prints need a decision (PRINTS_ENABLED=1), Stripe (to be paid) and Prodigi
 * (to be printed). Without all three nothing anywhere offers or promises one.
 */
export function isPrintsAvailable(): boolean {
  // Read live, like the Prodigi key, rather than from the parsed `env`.
  return process.env.PRINTS_ENABLED === "1" && Boolean(getStripe()) && isProdigiConfigured();
}

export class PrintError extends Error {
  constructor(readonly code: "unavailable" | "off" | "empty" | "too_many" | "not_allowed" | "not_found" | "state") {
    super(code);
  }
}

export const PRINT_REFUSALS: Record<PrintError["code"], string> = {
  unavailable: "Prints are not available yet",
  off: "This gallery does not offer prints",
  empty: "Choose at least one print",
  too_many: `An order can hold up to ${MAX_ORDER_LINES} prints`,
  not_allowed: "One of those photos cannot be printed",
  not_found: "That order is gone",
  state: "That order has already moved on",
};

/** A link that shows one order, for the buyer's return page and their email. */
export function orderKey(orderId: string): string {
  return createHmac("sha256", process.env.AUTH_SECRET ?? "").update(`print-order:${orderId}`).digest("base64url").slice(0, 32);
}

export function verifyOrderKey(orderId: string, key: string | null): boolean {
  if (!key) return false;
  const expected = Buffer.from(orderKey(orderId));
  const given = Buffer.from(key);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** `origin` is where the buyer ordered: Klik's own domain, or a venue's (VEN-3). */
export function orderUrl(orderId: string, origin = getAppUrl()): string {
  return `${origin}/prints/${orderId}?k=${orderKey(orderId)}`;
}

export interface CartLine {
  mediaId: string;
  product: string;
  copies: number;
}

/**
 * Starts an order: checks every photo against the buyer, prices it from
 * Klik's own list (never the browser's), and opens a Stripe checkout for it.
 * Returns where to send the buyer.
 */
export async function startOrder({
  event,
  viewer,
  lines,
  email,
  locale = "en",
  origin = getAppUrl(),
}: {
  event: Event;
  viewer: { isManager: boolean; guestId: string | null; userId: string | null };
  lines: CartLine[];
  email: string | null;
  /** TRS-3: the order page speaks the buyer's language. */
  locale?: "en" | "es";
  /** Where Stripe sends the buyer back to, so a venue's guest stays on its domain. */
  origin?: string;
}): Promise<{ orderId: string; url: string }> {
  const stripe = getStripe();
  // The same check every button uses, so an order cannot start by calling the
  // route directly while prints are switched off. Refunds below need only
  // Stripe: an order taken before a switch-off can still be put right.
  if (!stripe || !isPrintsAvailable()) throw new PrintError("unavailable");
  if (!event.printsEnabled || event.suspendedAt) throw new PrintError("off");
  const wanted = lines.filter((line) => line.copies > 0);
  if (wanted.length === 0) throw new PrintError("empty");
  if (wanted.length > MAX_ORDER_LINES) throw new PrintError("too_many");

  const rows = await db
    .select()
    .from(media)
    .where(and(eq(media.eventId, event.id), inArray(media.id, [...new Set(wanted.map((line) => line.mediaId))]), isNull(media.deletedAt)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const items: PrintOrderItem[] = [];
  for (const line of wanted) {
    const item = byId.get(line.mediaId);
    const product = productByKey(line.product);
    if (!item || !product || item.kind !== "photo" || isLockedProof(item) || item.legalHoldAt) throw new PrintError("not_allowed");
    if (!viewer.isManager) {
      if (!viewer.guestId || !canViewMedia(item, { isManager: false, guestId: viewer.guestId }, event)) throw new PrintError("not_allowed");
      if (!event.downloadsEnabled && item.guestId !== viewer.guestId) throw new PrintError("not_allowed");
    }
    items.push({ mediaId: item.id, product: product.key, copies: Math.min(MAX_COPIES, Math.max(1, Math.floor(line.copies))), unitCents: product.priceCents });
  }

  const subtotal = items.reduce((total, item) => total + item.unitCents * item.copies, 0);
  const id = `po_${nanoid()}`;
  await db.insert(printOrders).values({
    id,
    eventId: event.id,
    guestId: viewer.guestId,
    userId: viewer.userId,
    items,
    subtotalCents: subtotal,
    shippingCents: SHIPPING_CENTS,
    totalCents: subtotal + SHIPPING_CENTS,
    callbackToken: randomBytes(24).toString("base64url"),
  });

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    ...(email ? { customer_email: email } : {}),
    line_items: items.map((item) => ({
      quantity: item.copies,
      price_data: {
        currency: "usd",
        unit_amount: item.unitCents,
        product_data: { name: `${productByKey(item.product)!.label} photo print`, description: `From ${event.name}` },
        ...(process.env.STRIPE_PRINTS_AUTOMATIC_TAX === "1" ? { tax_behavior: "exclusive" as const } : {}),
      },
    })),
    shipping_address_collection: { allowed_countries: ["US"] },
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          display_name: "Standard shipping",
          fixed_amount: { amount: SHIPPING_CENTS, currency: "usd" },
          delivery_estimate: { minimum: { unit: "business_day", value: 5 }, maximum: { unit: "business_day", value: 10 } },
          ...(process.env.STRIPE_PRINTS_AUTOMATIC_TAX === "1" ? { tax_behavior: "exclusive" as const } : {}),
        },
      },
    ],
    ...(process.env.STRIPE_PRINTS_AUTOMATIC_TAX === "1" ? { automatic_tax: { enabled: true } } : {}),
    metadata: { printOrderId: id, eventId: event.id },
    payment_intent_data: { metadata: { printOrderId: id } },
    success_url: `${orderUrl(id, origin)}${locale === "es" ? "&l=es" : ""}&session_id={CHECKOUT_SESSION_ID}`,
    locale: locale === "es" ? "es" : "en",
    cancel_url: `${origin}/e/${event.slug}?prints=cancelled`,
    expires_at: Math.floor(Date.now() / 1000) + 2 * 60 * 60,
  });
  await db.update(printOrders).set({ stripeSessionId: session.id }).where(eq(printOrders.id, id));
  if (!session.url) throw new Error("Stripe returned no checkout URL");
  log.info("prints.order_started", { orderId: id, eventId: event.id, lines: items.length, subtotal });
  return { orderId: id, url: session.url };
}

function recipientOf(session: Stripe.Checkout.Session): PrintRecipient | null {
  // Since API 2025-03-31 the address lives under collected_information.
  const details =
    (session as unknown as { collected_information?: { shipping_details?: { name?: string; address?: Stripe.Address } } })
      .collected_information?.shipping_details ??
    (session as unknown as { shipping_details?: { name?: string; address?: Stripe.Address } }).shipping_details;
  const address = details?.address;
  if (!details?.name || !address?.line1 || !address.city || !address.postal_code || !address.country) return null;
  return {
    name: details.name,
    line1: address.line1,
    line2: address.line2 ?? null,
    city: address.city,
    state: address.state ?? "",
    postalCode: address.postal_code,
    country: address.country,
  };
}

/**
 * Asks Stripe whether an order's checkout was paid, and records it if so.
 * Safe to call from anywhere, as often as wanted: only the first call that
 * finds it paid writes, and only that one sends the emails.
 */
export async function confirmPayment(orderId: string): Promise<PrintOrder | null> {
  const [order] = await db.select().from(printOrders).where(eq(printOrders.id, orderId)).limit(1);
  if (!order) return null;
  if (order.status !== "awaiting_payment" || !order.stripeSessionId) return order;
  const stripe = getStripe();
  if (!stripe) return order;
  const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
  if (session.payment_status !== "paid") {
    if (session.status === "expired") {
      await db.update(printOrders).set({ status: "expired", closedAt: new Date() }).where(and(eq(printOrders.id, orderId), eq(printOrders.status, "awaiting_payment")));
    }
    return (await db.select().from(printOrders).where(eq(printOrders.id, orderId)).limit(1))[0] ?? null;
  }
  const recipient = recipientOf(session);
  const [paid] = await db
    .update(printOrders)
    .set({
      status: "paid",
      paidAt: new Date(),
      email: session.customer_details?.email ?? null,
      recipient,
      taxCents: session.total_details?.amount_tax ?? 0,
      totalCents: session.amount_total ?? order.totalCents,
      stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null),
    })
    .where(and(eq(printOrders.id, orderId), eq(printOrders.status, "awaiting_payment")))
    .returning();
  if (!paid) return (await db.select().from(printOrders).where(eq(printOrders.id, orderId)).limit(1))[0] ?? null;
  log.info("prints.paid", { orderId, totalCents: paid.totalCents });
  await notifyPaid(paid).catch((error) => reportError("prints.notify_failed", error, { orderId }));
  return paid;
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const footer = () => `Sent by ${getAppUrl().replace(/^https?:\/\//, "")} about prints you ordered.`;

async function notifyPaid(order: PrintOrder) {
  if (order.email) {
    await sendEmail({
      to: order.email,
      ...noticeEmail({
        subject: "Your Klik print order",
        heading: "Your prints are ordered",
        paragraphs: [
          `Thank you. We have your payment of ${dollars(order.totalCents)} for ${order.items.reduce((n, item) => n + item.copies, 0)} prints.`,
          "A person at Klik checks every order before it goes to the printer, usually within a day. Then they are printed and shipped, which takes about a week. We will email you when they are on their way.",
        ],
        cta: { label: "See your order", url: orderUrl(order.id) },
        footer: footer(),
      }),
    });
  }
  // Someone has to look at it: this is the queue's bell.
  if (process.env.ALERT_EMAIL) {
    await sendEmail({
      to: process.env.ALERT_EMAIL,
      subject: `Print order ${order.id} is waiting for review`,
      text: `A print order for ${dollars(order.totalCents)} was paid. Review it on ${getAppUrl()}/admin under Print orders.`,
      html: `<p>A print order for ${dollars(order.totalCents)} was paid. <a href="${getAppUrl()}/admin">Review it on /admin</a> under Print orders.</p>`,
    });
  }
}

/** For `/admin`: what Prodigi would charge, so the margin is visible before sending. */
export async function prodigiCost(order: PrintOrder): Promise<{ totalCents: number; currency: string } | null> {
  const lines = await Promise.all(
    order.items.map(async (item) => {
      const product = productByKey(item.product)!;
      return { sku: skuOf(product), copies: item.copies, attributes: chooseAttributes(await getProduct(skuOf(product)), PREFERRED_ATTRIBUTES) };
    }),
  );
  return quote(lines, order.recipient?.country ?? "US");
}

function callbackUrl(order: PrintOrder): string | null {
  if (process.env.VERCEL_ENV !== "production") return null;
  return `${getAppUrl()}/api/webhooks/prodigi/${order.id}/${order.callbackToken}`;
}

/**
 * A person's yes: sends a paid order to Prodigi. Every photo is checked
 * again (deleted, held or turned into a proof since), and the image links
 * last three days, longer than Prodigi takes to fetch them.
 */
export async function submitOrder(orderId: string, reviewerId: string): Promise<PrintOrder> {
  const [order] = await db.select().from(printOrders).where(eq(printOrders.id, orderId)).limit(1);
  if (!order) throw new PrintError("not_found");
  if (order.status !== "paid" || !order.recipient) throw new PrintError("state");
  const rows = await db.select().from(media).where(inArray(media.id, order.items.map((item) => item.mediaId)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const lines = [];
  for (const [index, item] of order.items.entries()) {
    const photo = byId.get(item.mediaId);
    if (!photo || photo.deletedAt || photo.legalHoldAt || isLockedProof(photo)) throw new PrintError("not_allowed");
    const product = productByKey(item.product)!;
    lines.push({
      sku: skuOf(product),
      copies: item.copies,
      attributes: chooseAttributes(await getProduct(skuOf(product)), PREFERRED_ATTRIBUTES),
      imageUrl: await signObjectUrl(photo.blobPathname, photo.mimeType, Date.now(), 36 * 60 * 60 * 1000),
      merchantReference: `${order.id}-${index + 1}`,
    });
  }
  const address: ProdigiAddress = {
    name: order.recipient.name,
    line1: order.recipient.line1,
    line2: order.recipient.line2,
    townOrCity: order.recipient.city,
    stateOrCounty: order.recipient.state,
    postalOrZipCode: order.recipient.postalCode,
    countryCode: order.recipient.country,
  };
  const placed = await createOrder({ merchantReference: order.id, recipient: address, email: order.email, lines, callbackUrl: callbackUrl(order) });
  const [updated] = await db
    .update(printOrders)
    .set({ status: "submitted", prodigiOrderId: placed.id, prodigiStage: placed.status.stage, submittedAt: new Date(), reviewedByUserId: reviewerId, error: null })
    .where(and(eq(printOrders.id, orderId), eq(printOrders.status, "paid")))
    .returning();
  log.info("prints.submitted", { orderId, prodigiOrderId: placed.id, live: prodigiIsLive() });
  return updated;
}

/** A person's no: refunds a paid order in full before it is printed. */
export async function refundOrder(orderId: string, reviewerId: string, note: string): Promise<PrintOrder> {
  const [order] = await db.select().from(printOrders).where(eq(printOrders.id, orderId)).limit(1);
  if (!order) throw new PrintError("not_found");
  if (order.status !== "paid" || !order.stripePaymentIntentId) throw new PrintError("state");
  const stripe = getStripe();
  if (!stripe) throw new PrintError("unavailable");
  await stripe.refunds.create({ payment_intent: order.stripePaymentIntentId, metadata: { printOrderId: order.id } });
  const [updated] = await db
    .update(printOrders)
    .set({ status: "refunded", closedAt: new Date(), reviewedByUserId: reviewerId, note: note.slice(0, 500) })
    .where(and(eq(printOrders.id, orderId), eq(printOrders.status, "paid")))
    .returning();
  if (order.email) {
    await sendEmail({
      to: order.email,
      ...noticeEmail({
        subject: "Your Klik print order was refunded",
        heading: "We could not print this order",
        paragraphs: [
          `We have refunded the full ${dollars(order.totalCents)} to your card. It usually shows within a few days.`,
          "If you would like to know why, reply to this email or call us and a person will tell you.",
        ],
        cta: { label: "See your order", url: orderUrl(order.id) },
        footer: footer(),
      }),
    }).catch((error) => reportError("prints.notify_failed", error, { orderId }));
  }
  return updated;
}

/**
 * Brings one submitted order up to date from Prodigi itself (a callback is
 * only ever a reason to look), and emails the buyer the first time there is
 * tracking.
 */
export async function syncFromProdigi(orderId: string): Promise<PrintOrder | null> {
  const [order] = await db.select().from(printOrders).where(eq(printOrders.id, orderId)).limit(1);
  if (!order?.prodigiOrderId || order.status !== "submitted") return order ?? null;
  const placed = await getOrder(order.prodigiOrderId);
  const tracking = trackingOf(placed);
  const stage = placed.status.stage;
  const shipped = tracking.length > 0 || stage === "Complete";
  const cancelled = stage === "Cancelled";
  const [updated] = await db
    .update(printOrders)
    .set({
      prodigiStage: stage,
      tracking: tracking.length > 0 ? tracking : order.tracking,
      ...(shipped ? { status: "shipped" as const, shippedAt: new Date(), closedAt: new Date() } : {}),
      ...(cancelled ? { status: "cancelled" as const, closedAt: new Date(), error: "Cancelled at Prodigi" } : {}),
    })
    .where(and(eq(printOrders.id, orderId), eq(printOrders.status, "submitted")))
    .returning();
  if (updated && shipped && order.email) {
    const first = tracking[0];
    await sendEmail({
      to: order.email,
      ...noticeEmail({
        subject: "Your prints are on their way",
        heading: "Your prints have shipped",
        paragraphs: [
          first?.number ? `Tracking${first.carrier ? ` with ${first.carrier}` : ""}: ${first.number}.` : "They are on their way to you.",
          "They usually arrive within a week.",
        ],
        cta: { label: first?.url ? "Track them" : "See your order", url: first?.url ?? orderUrl(order.id) },
        footer: footer(),
      }),
    }).catch((error) => reportError("prints.notify_failed", error, { orderId }));
  }
  return updated ?? order;
}

export function callbackTokenMatches(order: Pick<PrintOrder, "callbackToken">, token: string): boolean {
  const expected = Buffer.from(order.callbackToken);
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * The daily pass: a checkout never returned from is asked about (paid
 * meanwhile, or expired), submitted orders are looked at in case a callback
 * was lost, and closed orders lose their email and address once they are
 * old enough that nobody will need them for a return.
 */
export async function reconcilePrints(): Promise<void> {
  const stale = await db
    .select({ id: printOrders.id })
    .from(printOrders)
    .where(and(eq(printOrders.status, "awaiting_payment"), lt(printOrders.createdAt, sql`now() - interval '3 hours'`)))
    .limit(200);
  for (const { id } of stale) {
    await confirmPayment(id).catch(async (error) => {
      log.warn("prints.reconcile_failed", { orderId: id, error });
    });
    // A session Stripe no longer knows, or still open after a day: closed.
    await db
      .update(printOrders)
      .set({ status: "expired", closedAt: new Date() })
      .where(and(eq(printOrders.id, id), eq(printOrders.status, "awaiting_payment"), lt(printOrders.createdAt, sql`now() - interval '1 day'`)));
  }
  if (isProdigiConfigured()) {
    const submitted = await db.select({ id: printOrders.id }).from(printOrders).where(eq(printOrders.status, "submitted")).limit(200);
    for (const { id } of submitted) await syncFromProdigi(id).catch((error) => log.warn("prints.sync_failed", { orderId: id, error }));
  }
  await db
    .update(printOrders)
    .set({ email: null, recipient: null, redactedAt: new Date() })
    .where(
      and(
        isNull(printOrders.redactedAt),
        sql`${printOrders.closedAt} < now() - (${REDACT_AFTER_DAYS}::int * interval '1 day')`,
      ),
    );
}

/** For `/admin`: orders that need a person, then the recent rest. */
export async function listPrintOrders() {
  const [waiting, recent] = await Promise.all([
    db.select().from(printOrders).where(eq(printOrders.status, "paid")).orderBy(printOrders.paidAt).limit(100),
    db
      .select()
      .from(printOrders)
      .where(inArray(printOrders.status, ["submitted", "shipped", "refunded", "failed"]))
      .orderBy(desc(printOrders.createdAt))
      .limit(20),
  ]);
  const ids = [...new Set([...waiting, ...recent].flatMap((order) => order.items.map((item) => item.mediaId)))];
  const eventIds = [...new Set([...waiting, ...recent].map((order) => order.eventId).filter((id): id is string => Boolean(id)))];
  const [photos, eventRows] = await Promise.all([
    ids.length ? db.select().from(media).where(inArray(media.id, ids)) : Promise.resolve([]),
    eventIds.length ? db.select({ id: events.id, name: events.name, slug: events.slug }).from(events).where(inArray(events.id, eventIds)) : Promise.resolve([]),
  ]);
  return { waiting, recent, photos, events: eventRows };
}

/** For `/admin`: whether each SKU exists at Prodigi and what it needs. */
export async function checkCatalogue(): Promise<Array<{ key: string; sku: string; ok: boolean; detail: string }>> {
  return Promise.all(
    PRINT_PRODUCTS.map(async (product) => {
      try {
        const found = await getProduct(skuOf(product));
        const attributes = chooseAttributes(found, PREFERRED_ATTRIBUTES);
        const shipsToUs = found.variants?.some((variant) => variant.shipsTo?.includes("US")) ?? false;
        return {
          key: product.key,
          sku: skuOf(product),
          ok: shipsToUs,
          detail: `${found.description}${Object.keys(attributes).length ? `; ${Object.entries(attributes).map(([name, value]) => `${name} ${value}`).join(", ")}` : ""}${shipsToUs ? "" : "; does not ship to the US"}`,
        };
      } catch (error) {
        return { key: product.key, sku: skuOf(product), ok: false, detail: error instanceof Error ? error.message : "not found" };
      }
    }),
  );
}
