/**
 * GRW-6: Prodigi's Print API v4, which prints and ships the orders a person
 * at Klik has checked.
 *
 * Switched on by `PRODIGI_API_KEY`. `PRODIGI_ENV=live` sends orders to the
 * real printer; anything else is Prodigi's sandbox, where orders are accepted
 * and never printed or charged, which is where a new key should start.
 */

export function isProdigiConfigured(): boolean {
  return Boolean(process.env.PRODIGI_API_KEY);
}

export function prodigiIsLive(): boolean {
  return process.env.PRODIGI_ENV === "live";
}

function base(): string {
  return prodigiIsLive() ? "https://api.prodigi.com/v4.0" : "https://api.sandbox.prodigi.com/v4.0";
}

export class ProdigiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProdigiError";
  }
}

interface Options {
  fetchImpl?: typeof fetch;
}

async function call<T>(path: string, init: RequestInit = {}, options: Options = {}): Promise<T> {
  const key = process.env.PRODIGI_API_KEY;
  if (!key) throw new ProdigiError("Prodigi is not configured", 0);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(`${base()}${path}`, {
      ...init,
      headers: { "X-API-Key": key, "Content-Type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new ProdigiError(`Prodigi unreachable: ${error instanceof Error ? error.message : String(error)}`, 0);
  }
  const body = (await response.json().catch(() => null)) as (T & { outcome?: string; failures?: unknown; traceParent?: string }) | null;
  if (!response.ok || !body) {
    const detail = body ? JSON.stringify(body.failures ?? body.outcome ?? body).slice(0, 300) : `HTTP ${response.status}`;
    throw new ProdigiError(`Prodigi ${path}: ${detail}`, response.status);
  }
  return body;
}

export interface ProdigiProduct {
  sku: string;
  description: string;
  attributes: Record<string, string[]>;
  printAreas: Record<string, { required: boolean }>;
  variants: Array<{
    attributes: Record<string, string>;
    shipsTo: string[];
    printAreaSizes: Record<string, { horizontalResolution: number; verticalResolution: number }>;
  }>;
}

const productCache = new Map<string, { product: ProdigiProduct; at: number }>();

/** A product's attributes and print areas, kept for a day per instance. */
export async function getProduct(sku: string, options: Options = {}): Promise<ProdigiProduct> {
  const hit = productCache.get(sku);
  if (hit && Date.now() - hit.at < 24 * 60 * 60 * 1000) return hit.product;
  const { product } = await call<{ product: ProdigiProduct }>(`/products/${encodeURIComponent(sku)}`, {}, options);
  productCache.set(sku, { product, at: Date.now() });
  return product;
}

/**
 * The attributes an order line must carry. Where the product offers a
 * choice, Klik's preference wins when it is on offer (lustre, for photo
 * prints), and otherwise the first option, so a product that adds a required
 * attribute later still orders.
 */
export function chooseAttributes(product: Pick<ProdigiProduct, "attributes">, preferred: Record<string, string> = {}): Record<string, string> {
  const chosen: Record<string, string> = {};
  for (const [name, values] of Object.entries(product.attributes ?? {})) {
    if (!Array.isArray(values) || values.length === 0) continue;
    chosen[name] = values.includes(preferred[name]) ? preferred[name] : values[0];
  }
  return chosen;
}

export interface OrderLine {
  sku: string;
  copies: number;
  attributes: Record<string, string>;
  imageUrl: string;
  merchantReference: string;
}

export interface ProdigiAddress {
  name: string;
  line1: string;
  line2: string | null;
  townOrCity: string;
  stateOrCounty: string;
  postalOrZipCode: string;
  countryCode: string;
}

export interface ProdigiOrder {
  id: string;
  status: { stage: string; issues?: unknown[] };
  shipments?: Array<{ carrier?: { name?: string; service?: string }; tracking?: { number?: string; url?: string }; status?: string }>;
}

export async function createOrder(
  {
    merchantReference,
    recipient,
    email,
    lines,
    callbackUrl,
  }: { merchantReference: string; recipient: ProdigiAddress; email: string | null; lines: OrderLine[]; callbackUrl: string | null },
  options: Options = {},
): Promise<ProdigiOrder> {
  const { order } = await call<{ order: ProdigiOrder }>(
    "/orders",
    {
      method: "POST",
      // Prodigi treats a repeated idempotency key as the same order, so a
      // retried submit cannot print twice.
      headers: { "Idempotency-Key": merchantReference },
      body: JSON.stringify({
        merchantReference,
        shippingMethod: "Standard",
        ...(callbackUrl ? { callbackUrl } : {}),
        recipient: {
          name: recipient.name,
          ...(email ? { email } : {}),
          address: {
            line1: recipient.line1,
            ...(recipient.line2 ? { line2: recipient.line2 } : {}),
            postalOrZipCode: recipient.postalOrZipCode,
            countryCode: recipient.countryCode,
            townOrCity: recipient.townOrCity,
            stateOrCounty: recipient.stateOrCounty,
          },
        },
        items: lines.map((line) => ({
          merchantReference: line.merchantReference,
          sku: line.sku,
          copies: line.copies,
          sizing: "fillPrintArea",
          attributes: line.attributes,
          assets: [{ printArea: "default", url: line.imageUrl }],
        })),
      }),
    },
    options,
  );
  return order;
}

export async function getOrder(id: string, options: Options = {}): Promise<ProdigiOrder> {
  const { order } = await call<{ order: ProdigiOrder }>(`/orders/${encodeURIComponent(id)}`, {}, options);
  return order;
}

export interface QuoteLine {
  sku: string;
  copies: number;
  attributes: Record<string, string>;
}

/** What Prodigi will charge Klik for these lines, shipped Standard to one country. */
export async function quote(lines: QuoteLine[], countryCode: string, options: Options = {}): Promise<{ totalCents: number; currency: string } | null> {
  const { quotes } = await call<{
    quotes: Array<{ shipmentMethod: string; costSummary: { totalCost: { amount: string; currency: string } } }>;
  }>(
    "/quotes",
    {
      method: "POST",
      body: JSON.stringify({
        shippingMethod: "Standard",
        destinationCountryCode: countryCode,
        currencyCode: "USD",
        items: lines.map((line) => ({ sku: line.sku, copies: line.copies, attributes: line.attributes, assets: [{ printArea: "default" }] })),
      }),
    },
    options,
  );
  const standard = quotes.find((entry) => entry.shipmentMethod?.toLowerCase() === "standard") ?? quotes[0];
  if (!standard) return null;
  return { totalCents: Math.round(Number(standard.costSummary.totalCost.amount) * 100), currency: standard.costSummary.totalCost.currency };
}

/** The tracking Prodigi has so far, in Klik's shape. */
export function trackingOf(order: Pick<ProdigiOrder, "shipments">) {
  return (order.shipments ?? [])
    .map((shipment) => ({
      carrier: shipment.carrier?.name ?? null,
      number: shipment.tracking?.number ?? null,
      url: shipment.tracking?.url ?? null,
    }))
    .filter((entry) => entry.number || entry.url);
}
