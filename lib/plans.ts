export const PLAN_KEYS = ["event", "premium", "venue"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

const MB = 1024 * 1024;
const GB = 1024 * MB;

export type PlanDefinition = {
  key: PlanKey;
  name: string;
  price: string;
  priceSuffix: string;
  billingNote?: string;
  priceNote?: string;
  description: string;
  maxActiveEvents: number;
  maxEventsPerMonth: number;
  uploadWindowDays: number;
  galleryAccessDays: number;
  maxPhotoBytes: number;
  maxVideoBytes: number;
  /**
   * Hard ceiling on a single clip, in seconds. The byte cap alone is a blunt
   * control: a heavily compressed 10-minute recording fits inside 500 MB, and
   * nobody wants to stream that to a phone on venue wifi. Until OPS-1 adds
   * real transcoding, this is what keeps video sane.
   */
  maxVideoSeconds: number;
  /**
   * How many co-hosts an event may have. Zero means the feature is off, which
   * is what `canUseCoHosts` now reads, so adding a plan with co-hosts is a
   * number here rather than another plan key in a chain of comparisons.
   */
  maxCoHosts: number;
  /**
   * F-4: the storage an event may hold, and the enforced limit. Video is what
   * costs, so the cap is in bytes, and hitting it blocks new uploads.
   */
  maxStorageBytesPerEvent: number;
  /**
   * The number people reason about. About what fits in the storage at a typical
   * 1.5 MB a photo after compression. Passing it only warns: a guest at a
   * wedding must never be told "no" over a number the host could not see.
   */
  photoHeadline: number;
  /** PAY-6: folders an event may have. Zero means the feature is off. */
  maxAlbums: number;
  features: readonly string[];
  featured?: boolean;
};

export const PLANS: Record<PlanKey, PlanDefinition> = {
  event: {
    key: "event",
    name: "Klik Event",
    price: "$39",
    priceSuffix: "one-time",
    description: "For birthdays, graduations, reunions, and smaller weddings.",
    maxActiveEvents: 1,
    maxEventsPerMonth: 1,
    uploadWindowDays: 30,
    galleryAccessDays: 180,
    maxPhotoBytes: 25 * MB,
    maxVideoBytes: 200 * MB,
    maxVideoSeconds: 60,
    maxCoHosts: 0,
    maxStorageBytesPerEvent: 25 * GB,
    photoHeadline: 1000,
    maxAlbums: 0,
    features: [
      "Unlimited guests",
      "Photos and videos",
      "Shared live gallery",
      "Public, password, or private access",
      "Host moderation",
      "Guest download controls",
      "Download-all ZIP",
      "30-day upload window",
      "6-month gallery access",
      "Room for about 1,000 photos (25 GB)",
      "One QR code and one gallery",
      "No subscription",
    ],
    featured: true,
  },
  premium: {
    key: "premium",
    name: "Klik Premium",
    price: "$89",
    priceSuffix: "one-time",
    description: "More control, customization, and a premium experience.",
    maxActiveEvents: 1,
    maxEventsPerMonth: 1,
    uploadWindowDays: 365,
    galleryAccessDays: 365,
    maxPhotoBytes: 25 * MB,
    maxVideoBytes: 500 * MB,
    maxVideoSeconds: 180,
    maxCoHosts: 5,
    maxStorageBytesPerEvent: 100 * GB,
    photoHeadline: 5000,
    maxAlbums: 50,
    features: [
      "Everything in Klik Event",
      "12-month upload window",
      "Room for about 5,000 photos (100 GB)",
      "Folders within an event, nested three deep",
      "Multiple organizers or co-hosts",
      "Custom gallery colors and cover",
      "Custom QR sign templates",
      "Live full-screen slideshow",
      "Removal of Klik branding",
      "Priority support",
      "Longer video limits",
    ],
  },
  venue: {
    key: "venue",
    name: "Klik Venue",
    price: "$69",
    priceSuffix: "per month",
    billingNote: "3-month minimum commitment",
    priceNote: "$690 annual option",
    description: "For venues and professionals managing several live events.",
    maxActiveEvents: 5,
    maxEventsPerMonth: 5,
    uploadWindowDays: 365,
    galleryAccessDays: 365,
    maxPhotoBytes: 25 * MB,
    maxVideoBytes: 500 * MB,
    maxVideoSeconds: 180,
    maxCoHosts: 10,
    maxStorageBytesPerEvent: 100 * GB,
    photoHeadline: 5000,
    maxAlbums: 0,
    features: [
      "Up to 5 active events per month",
      "Central venue dashboard",
      "Reusable venue QR code",
      "Client and event management",
      "Downloadable event QR signs",
      "12-month event storage",
      "100 GB per event",
    ],
  },
};

export function getPlan(planKey: PlanKey | null | undefined): PlanDefinition {
  return PLANS[planKey ?? "event"] ?? PLANS.event;
}

export function canUseSlideshow(planKey: PlanKey): boolean {
  return planKey === "premium" || planKey === "venue";
}

/** VEN-2: a tablet at the venue that only takes photos. Same tiers as the live display. */
/**
 * MED-10: watermarked proofs, for a photographer on the event's team. On the
 * plans that have a team at all.
 */
export function canUseProofs(planKey: PlanKey): boolean {
  return planKey === "premium" || planKey === "venue";
}

export function canUseKiosk(planKey: PlanKey): boolean {
  return planKey === "premium" || planKey === "venue";
}

export function canUseAlbums(planKey: PlanKey): boolean {
  return planKey === "premium";
}

/**
 * Derived from the cap rather than compared against a plan key. The literal
 * `planKey === "premium"` was a latent bug: Venue accounts would have been
 * refused co-hosts despite paying for a plan built around running events for
 * other people. See ROADMAP.md ORG-2.
 */
export function canUseCoHosts(planKey: PlanKey | null | undefined): boolean {
  return getPlan(planKey).maxCoHosts > 0;
}

export function canCustomizeGallery(planKey: PlanKey): boolean {
  return planKey === "premium";
}

export function canCustomizeQr(planKey: PlanKey): boolean {
  return planKey === "premium";
}

export function removesKlikBranding(planKey: PlanKey): boolean {
  return planKey === "premium";
}

export function canManageEventClients(planKey: PlanKey): boolean {
  return planKey === "venue";
}

export function canUseVenueHub(planKey: PlanKey): boolean {
  return planKey === "venue";
}

export function canDownloadQrSign(planKey: PlanKey): boolean {
  return planKey === "premium" || planKey === "venue";
}

/**
 * QR-4: the print studio. The same tiers as the printable sign it grows out
 * of, so no plan loses a sign it had and none gains a studio it did not buy.
 */
export function canUsePrintStudio(planKey: PlanKey): boolean {
  return canDownloadQrSign(planKey);
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * MB) return `${Math.round(bytes / (1024 * MB))} GB`;
  return `${Math.round(bytes / MB)} MB`;
}

export function getPlanDeadline(createdAt: Date, days: number): Date {
  return new Date(createdAt.getTime() + days * 24 * 60 * 60 * 1000);
}
