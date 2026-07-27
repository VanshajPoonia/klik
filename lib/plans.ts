export const PLAN_KEYS = ["event", "premium", "venue"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

const MB = 1024 * 1024;

export type PlanDefinition = {
  key: PlanKey;
  name: string;
  price: string;
  priceSuffix: string;
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
    priceSuffix: "one-time launch price",
    priceNote: "$49 after the introductory period",
    description: "For birthdays, graduations, reunions, and smaller weddings.",
    maxActiveEvents: 1,
    maxEventsPerMonth: 1,
    uploadWindowDays: 90,
    galleryAccessDays: 365,
    maxPhotoBytes: 25 * MB,
    maxVideoBytes: 200 * MB,
    features: [
      "Unlimited guests",
      "Photos and videos",
      "Shared live gallery",
      "Public, password, or private access",
      "Host moderation and guest download controls",
      "Download-all ZIP",
      "3-month upload window",
      "12-month gallery access",
      "One QR code and one gallery",
    ],
    featured: true,
  },
  premium: {
    key: "premium",
    name: "Klik Premium",
    price: "$89",
    priceSuffix: "one-time",
    description: "For hosts who need a longer collection window and larger videos.",
    maxActiveEvents: 1,
    maxEventsPerMonth: 1,
    uploadWindowDays: 365,
    galleryAccessDays: 365,
    maxPhotoBytes: 25 * MB,
    maxVideoBytes: 500 * MB,
    features: [
      "Everything in Klik Event",
      "12-month upload window",
      "Videos up to 500 MB",
      "Original photo and video downloads",
      "Live full-screen slideshow",
      "Host moderation and guest download controls",
      "12-month gallery access",
    ],
  },
  venue: {
    key: "venue",
    name: "Klik Venue",
    price: "~$69",
    priceSuffix: "per month",
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
      "Central event dashboard",
      "Client and event management",
      "Downloadable event QR signs",
      "12-month event storage",
      "Videos up to 500 MB",
      "Moderation and guest download controls",
    ],
  },
};

export function getPlan(planKey: PlanKey | null | undefined): PlanDefinition {
  return PLANS[planKey ?? "event"] ?? PLANS.event;
}

export function canUseSlideshow(planKey: PlanKey): boolean {
  return planKey === "premium" || planKey === "venue";
}

export function canManageEventClients(planKey: PlanKey): boolean {
  return planKey === "venue";
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * MB) return `${Math.round(bytes / (1024 * MB))} GB`;
  return `${Math.round(bytes / MB)} MB`;
}

export function getPlanDeadline(createdAt: Date, days: number): Date {
  return new Date(createdAt.getTime() + days * 24 * 60 * 60 * 1000);
}
