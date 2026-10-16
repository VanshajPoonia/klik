import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const sendEmail = vi.fn(async () => ({ id: "email" }));

/** Stripe, as much of it as prints touch. */
const sessions = new Map<string, Record<string, unknown>>();
const createdSessions: Array<Record<string, unknown>> = [];
const refunds: Array<Record<string, unknown>> = [];
const fakeStripe = {
  checkout: {
    sessions: {
      create: vi.fn(async (params: Record<string, unknown>) => {
        const id = `cs_test_${createdSessions.length + 1}`;
        createdSessions.push(params);
        sessions.set(id, { id, payment_status: "unpaid", status: "open" });
        return { id, url: `https://checkout.stripe.test/${id}` };
      }),
      retrieve: vi.fn(async (id: string) => sessions.get(id)),
    },
  },
  refunds: { create: vi.fn(async (params: Record<string, unknown>) => (refunds.push(params), { id: "re_1" })) },
};
let stripeOn = true;

vi.mock("@/lib/db", async () => ({ db: (await import("./harness")).testDb }));
vi.mock("@/lib/email", () => ({ isEmailConfigured: () => true, sendEmail }));
vi.mock("@/lib/stripe", () => ({ getStripe: () => (stripeOn ? fakeStripe : null) }));
vi.mock("@/lib/media-urls", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media-urls")>()),
  signObjectUrl: async (key: string) => `https://r2.test/${key}?signed`,
}));

const { startOrder, confirmPayment, submitOrder, refundOrder, syncFromProdigi, reconcilePrints, verifyOrderKey, orderKey, PrintError } =
  await import("@/lib/prints");
const { POST: callback } = await import("@/app/api/webhooks/prodigi/[orderId]/[token]/route");
const { events, media, printOrders } = await import("@/lib/schema");
const { closeDatabase, makeEvent, makeGuest, makeMedia, makeUser, resetDatabase, testDb } = await import("./harness");

/** Prodigi, faked. */
const prodigiOrders: Array<Record<string, unknown>> = [];
let prodigiStage = "InProgress";
let shipments: unknown[] = [];
function prodigi(url: string, init?: RequestInit): Response {
  const path = new URL(url).pathname;
  if (path.startsWith("/v4.0/products/")) {
    return Response.json({
      outcome: "Ok",
      product: {
        sku: decodeURIComponent(path.split("/").pop()!),
        description: "C-type print",
        attributes: { finish: ["gloss", "lustre"] },
        printAreas: { default: { required: true } },
        variants: [{ attributes: {}, shipsTo: ["US", "GB"], printAreaSizes: { default: { horizontalResolution: 1800, verticalResolution: 1200 } } }],
      },
    });
  }
  if (path === "/v4.0/orders" && init?.method === "POST") {
    prodigiOrders.push({ body: JSON.parse(String(init.body)), headers: init.headers });
    return Response.json({ outcome: "Created", order: { id: "ord_1", status: { stage: "InProgress" } } });
  }
  if (path === "/v4.0/orders/ord_1") return Response.json({ outcome: "Ok", order: { id: "ord_1", status: { stage: prodigiStage }, shipments } });
  return Response.json({ outcome: "NotFound" }, { status: 404 });
}

beforeEach(async () => {
  sendEmail.mockClear();
  sessions.clear();
  createdSessions.length = 0;
  refunds.length = 0;
  prodigiOrders.length = 0;
  prodigiStage = "InProgress";
  shipments = [];
  stripeOn = true;
  process.env.PRODIGI_API_KEY = "prodigi-sandbox-key";
  process.env.PRINTS_ENABLED = "1";
  process.env.ALERT_EMAIL = "ops@example.test";
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => prodigi(String(input), init)));
  await resetDatabase();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PRODIGI_API_KEY;
  delete process.env.PRINTS_ENABLED;
  delete process.env.ALERT_EMAIL;
});
afterAll(closeDatabase);

async function gallery(overrides: Partial<typeof events.$inferInsert> = {}) {
  const owner = await makeUser();
  const eventId = await makeEvent(owner, { downloadsEnabled: true, ...overrides });
  const [event] = await testDb.select().from(events).where(eq(events.id, eventId));
  const guestId = await makeGuest(eventId);
  return { owner, event, eventId, guestId };
}

const asGuest = (guestId: string) => ({ isManager: false, guestId, userId: null });

describe("starting an order", () => {
  it("prices every line from Klik's own list and opens a US-only Stripe checkout", async () => {
    const { event, eventId, guestId } = await gallery();
    const a = await makeMedia(eventId, { width: 2560, height: 1707 });
    const b = await makeMedia(eventId);
    const { orderId, url } = await startOrder({
      event,
      viewer: asGuest(guestId),
      lines: [
        { mediaId: a, product: "4x6", copies: 3 },
        { mediaId: b, product: "8x10", copies: 99 },
      ],
      email: "buyer@example.test",
    });
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const [order] = await testDb.select().from(printOrders).where(eq(printOrders.id, orderId));
    // Copies are capped; the browser never names a price.
    expect(order.items).toEqual([
      { mediaId: a, product: "4x6", copies: 3, unitCents: 299 },
      { mediaId: b, product: "8x10", copies: 20, unitCents: 1299 },
    ]);
    expect(order).toMatchObject({ status: "awaiting_payment", subtotalCents: 3 * 299 + 20 * 1299, shippingCents: 599, guestId });
    const session = createdSessions[0] as {
      line_items: Array<{ quantity: number; price_data: { unit_amount: number } }>;
      shipping_address_collection: { allowed_countries: string[] };
      metadata: { printOrderId: string };
      success_url: string;
      customer_email: string;
    };
    expect(session.line_items.map((line) => [line.quantity, line.price_data.unit_amount])).toEqual([
      [3, 299],
      [20, 1299],
    ]);
    expect(session.shipping_address_collection.allowed_countries).toEqual(["US"]);
    expect(session.metadata.printOrderId).toBe(orderId);
    expect(session.success_url).toContain(`/prints/${orderId}?k=${orderKey(orderId)}`);
    expect(session.customer_email).toBe("buyer@example.test");
  });

  it("is refused without both providers, when the host has prints off, and for anything the buyer could not download", async () => {
    const { owner, event, eventId, guestId } = await gallery();
    const ok = await makeMedia(eventId);
    const hidden = await makeMedia(eventId, { visibility: "private" });
    const video = await makeMedia(eventId, { kind: "video", mimeType: "video/mp4" });
    const proof = await makeMedia(eventId, { proofBy: owner, proofOriginalPathname: "clean.jpg" });
    const line = (mediaId: string) => [{ mediaId, product: "4x6", copies: 1 }];

    for (const mediaId of [hidden, video, proof]) {
      await expect(startOrder({ event, viewer: asGuest(guestId), lines: line(mediaId), email: null })).rejects.toMatchObject({
        code: "not_allowed",
      });
    }
    await expect(startOrder({ event, viewer: asGuest(guestId), lines: [{ mediaId: ok, product: "poster", copies: 1 }], email: null })).rejects.toBeInstanceOf(PrintError);
    await expect(startOrder({ event: { ...event, printsEnabled: false }, viewer: asGuest(guestId), lines: line(ok), email: null })).rejects.toMatchObject({ code: "off" });
    stripeOn = false;
    await expect(startOrder({ event, viewer: asGuest(guestId), lines: line(ok), email: null })).rejects.toMatchObject({ code: "unavailable" });
    stripeOn = true;
    delete process.env.PRODIGI_API_KEY;
    await expect(startOrder({ event, viewer: asGuest(guestId), lines: line(ok), email: null })).rejects.toMatchObject({ code: "unavailable" });
    // Both keys set is still not a decision to sell prints.
    process.env.PRODIGI_API_KEY = "prodigi-sandbox-key";
    delete process.env.PRINTS_ENABLED;
    await expect(startOrder({ event, viewer: asGuest(guestId), lines: line(ok), email: null })).rejects.toMatchObject({ code: "unavailable" });
  });

  it("follows the download switch, except for the guest's own photos and the team", async () => {
    const { event, eventId, guestId } = await gallery({ downloadsEnabled: false });
    const theirs = await makeMedia(eventId);
    const mine = await makeMedia(eventId, { guestId });
    const line = (mediaId: string) => [{ mediaId, product: "5x7", copies: 1 }];
    await expect(startOrder({ event, viewer: asGuest(guestId), lines: line(theirs), email: null })).rejects.toMatchObject({ code: "not_allowed" });
    await expect(startOrder({ event, viewer: asGuest(guestId), lines: line(mine), email: null })).resolves.toBeTruthy();
    await expect(startOrder({ event, viewer: { isManager: true, guestId: null, userId: null }, lines: line(theirs), email: null })).resolves.toBeTruthy();
  });
});

async function paidOrder() {
  const { event, eventId, guestId } = await gallery();
  const photo = await makeMedia(eventId, { width: 2560, height: 1707 });
  const { orderId } = await startOrder({ event, viewer: asGuest(guestId), lines: [{ mediaId: photo, product: "4x6", copies: 2 }], email: null });
  const [order] = await testDb.select().from(printOrders).where(eq(printOrders.id, orderId));
  sessions.set(order.stripeSessionId!, {
    id: order.stripeSessionId,
    payment_status: "paid",
    status: "complete",
    amount_total: 1197,
    total_details: { amount_tax: 0 },
    payment_intent: "pi_123",
    customer_details: { email: "buyer@example.test" },
    collected_information: {
      shipping_details: { name: "Maya Lopez", address: { line1: "1 Main St", line2: null, city: "Austin", state: "TX", postal_code: "78701", country: "US" } },
    },
  });
  await confirmPayment(orderId);
  return { orderId, photo, eventId };
}

describe("payment", () => {
  it("is recorded only when Stripe says so, once, with the address Stripe collected", async () => {
    const { event, eventId, guestId } = await gallery();
    const photo = await makeMedia(eventId);
    const { orderId } = await startOrder({ event, viewer: asGuest(guestId), lines: [{ mediaId: photo, product: "4x6", copies: 1 }], email: null });
    expect((await confirmPayment(orderId))?.status).toBe("awaiting_payment");
    expect(sendEmail).not.toHaveBeenCalled();

    await resetDatabase();
    sendEmail.mockClear();
    const paid = await paidOrder();
    const [order] = await testDb.select().from(printOrders).where(eq(printOrders.id, paid.orderId));
    expect(order).toMatchObject({
      status: "paid",
      email: "buyer@example.test",
      totalCents: 1197,
      stripePaymentIntentId: "pi_123",
      recipient: { name: "Maya Lopez", line1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701", country: "US" },
    });
    // The buyer and the review queue's bell.
    expect(sendEmail.mock.calls.map((call) => (call as unknown as [{ to: string }])[0].to).sort()).toEqual(["buyer@example.test", "ops@example.test"]);
    await confirmPayment(paid.orderId);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
});

describe("a person's review", () => {
  it("sends a paid order to Prodigi with lustre, the signed photo, and an idempotency key", async () => {
    const { orderId, photo, eventId } = await paidOrder();
    const reviewer = await makeUser({ role: "superadmin" });
    const updated = await submitOrder(orderId, reviewer);
    expect(updated).toMatchObject({ status: "submitted", prodigiOrderId: "ord_1", reviewedByUserId: reviewer });
    const sent = prodigiOrders[0] as { body: Record<string, unknown>; headers: Record<string, string> };
    expect(sent.headers["Idempotency-Key"]).toBe(orderId);
    expect(sent.body).toMatchObject({
      merchantReference: orderId,
      shippingMethod: "Standard",
      recipient: { name: "Maya Lopez", email: "buyer@example.test", address: { line1: "1 Main St", townOrCity: "Austin", stateOrCounty: "TX", postalOrZipCode: "78701", countryCode: "US" } },
      items: [
        {
          sku: "GLOBAL-PHO-4X6",
          copies: 2,
          sizing: "fillPrintArea",
          attributes: { finish: "lustre" },
          assets: [{ printArea: "default", url: `https://r2.test/events/${eventId}/${photo}.jpg?signed` }],
        },
      ],
    });
    await expect(submitOrder(orderId, reviewer)).rejects.toMatchObject({ code: "state" });
  });

  it("will not print a photo deleted since it was ordered", async () => {
    const { orderId, photo } = await paidOrder();
    await testDb.update(media).set({ deletedAt: new Date() }).where(eq(media.id, photo));
    await expect(submitOrder(orderId, await makeUser())).rejects.toMatchObject({ code: "not_allowed" });
    expect(prodigiOrders).toHaveLength(0);
  });

  it("refunds in full instead, and tells the buyer", async () => {
    const { orderId } = await paidOrder();
    sendEmail.mockClear();
    const updated = await refundOrder(orderId, await makeUser(), "Photo is not suitable");
    expect(updated).toMatchObject({ status: "refunded", note: "Photo is not suitable" });
    expect(refunds).toEqual([{ payment_intent: "pi_123", metadata: { printOrderId: orderId } }]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe("after the printer", () => {
  it("reads Prodigi on a callback with the right secret, and tells the buyer once it ships", async () => {
    const { orderId } = await paidOrder();
    await submitOrder(orderId, await makeUser());
    const [order] = await testDb.select().from(printOrders).where(eq(printOrders.id, orderId));
    const params = (token: string) => ({ params: Promise.resolve({ orderId, token }) });

    expect((await callback(new Request("http://x", { method: "POST" }), params("wrong"))).status).toBe(404);
    expect((await callback(new Request("http://x", { method: "POST" }), params(order.callbackToken))).status).toBe(200);
    expect((await testDb.select().from(printOrders).where(eq(printOrders.id, orderId)))[0].status).toBe("submitted");

    sendEmail.mockClear();
    shipments = [{ carrier: { name: "USPS" }, tracking: { number: "9400111", url: "https://track.example/9400111" } }];
    await syncFromProdigi(orderId);
    const [shipped] = await testDb.select().from(printOrders).where(eq(printOrders.id, orderId));
    expect(shipped).toMatchObject({ status: "shipped", tracking: [{ carrier: "USPS", number: "9400111", url: "https://track.example/9400111" }] });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    await syncFromProdigi(orderId);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("expires checkouts nobody finished, and forgets addresses once an order is long closed", async () => {
    const { event, eventId, guestId } = await gallery();
    const photo = await makeMedia(eventId);
    const { orderId } = await startOrder({ event, viewer: asGuest(guestId), lines: [{ mediaId: photo, product: "4x6", copies: 1 }], email: null });
    await testDb.update(printOrders).set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }).where(eq(printOrders.id, orderId));

    const { orderId: oldPaid } = await paidOrder();
    await testDb
      .update(printOrders)
      .set({ status: "shipped", closedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000) })
      .where(eq(printOrders.id, oldPaid));

    await reconcilePrints();
    expect((await testDb.select().from(printOrders).where(eq(printOrders.id, orderId)))[0].status).toBe("expired");
    const [redacted] = await testDb.select().from(printOrders).where(eq(printOrders.id, oldPaid));
    expect(redacted).toMatchObject({ email: null, recipient: null });
    expect(redacted.redactedAt).toBeInstanceOf(Date);
  });
});

describe("the buyer's link", () => {
  it("opens only with the key made for that order", () => {
    expect(verifyOrderKey("po_1", orderKey("po_1"))).toBe(true);
    expect(verifyOrderKey("po_2", orderKey("po_1"))).toBe(false);
    expect(verifyOrderKey("po_1", null)).toBe(false);
  });
});
