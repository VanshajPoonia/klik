export const PLAN_KEYS = ["event", "premium", "venue"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

const MB = 1024 * 1024;

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
    features: [
      "Everything in Klik Event",
      "12-month upload window",
      "Multiple albums within an event",
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
    features: [
      "Up to 5 active events per month",
      "Central venue dashboard",
      "Reusable venue QR code",
      "Client and event management",
      "Downloadable event QR signs",
      "12-month event storage",
      "$690 annual option",
    ],
  },
};

export function getPlan(planKey: PlanKey | null | undefined): PlanDefinition {
  return PLANS[planKey ?? "event"] ?? PLANS.event;
}

export function canUseSlideshow(planKey: PlanKey): boolean {
  return planKey === "premium" || planKey === "venue";
}

export function canUseAlbums(planKey: PlanKey): boolean {
  return planKey === "premium";
}

export function canUseCoHosts(planKey: PlanKey): boolean {
  return planKey === "premium";
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

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * MB) return `${Math.round(bytes / (1024 * MB))} GB`;
  return `${Math.round(bytes / MB)} MB`;
}

export function getPlanDeadline(createdAt: Date, days: number): Date {
  return new Date(createdAt.getTime() + days * 24 * 60 * 60 * 1000);
}
