import { z } from "zod";

/**
 * AI-2, AI-4, AI-6: what Klik asks a vision model about each photo, and how
 * it reads the answer. Pure, so the prompt, the parsing and the search
 * ranking are tested without a model; the call itself is in
 * `lib/ai/workers-ai.ts` and the job in `lib/job-handlers/vision.ts`.
 *
 * **One call per photo answers three questions.** A caption (for search by
 * meaning, through a text embedding of it), labels from a fixed set (for
 * scenes and smart folders) and three safety questions (for AI-6). Asking a
 * vision-language model rather than embedding pixels is forced and also
 * better: Workers AI has no image embedding model, and a caption is something
 * an organizer can read, so a search result can say why it matched. Decided
 * 2026-10-11; see ROADMAP.md section C.
 *
 * **What it is never asked.** Who anyone is, or their age, race, religion,
 * health or any other trait. AI-3 was cut over biometrics, and a caption that
 * guessed "a child" or "an elderly man" would be the same exposure by the back
 * door. The prompt says so, and nothing reads such a guess if one appears.
 */

export const VISION_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const EMBEDDING_DIMENSIONS = 1024;

/** The long edge of the rendition sent to the model: enough to read a scene,
 * small enough to keep each photo to a few hundred tokens. */
export const VISION_EDGE = 512;

export const SCENE_LABELS = [
  "cake",
  "food",
  "drinks",
  "dancing",
  "speech",
  "ceremony",
  "performance",
  "group",
  "portrait",
  "couple",
  "selfie",
  "decor",
  "venue",
  "outdoors",
  "lights",
  "games",
  "pets",
  "details",
  "screenshot",
] as const;
export type SceneLabel = (typeof SCENE_LABELS)[number];

export function isSceneLabel(value: unknown): value is SceneLabel {
  return typeof value === "string" && (SCENE_LABELS as readonly string[]).includes(value);
}

/** What each label means, as the model is told and as the embedding reads it. */
const LABEL_MEANING: Record<SceneLabel, string> = {
  cake: "a cake or a dessert table",
  food: "food or a meal",
  drinks: "drinks, a toast or the bar",
  dancing: "people dancing",
  speech: "someone giving a speech or holding a microphone",
  ceremony: "a ceremony: vows, an aisle, an altar or rings being exchanged",
  performance: "a band, a DJ or a performer",
  group: "a group of several people posing together",
  portrait: "one person posing",
  couple: "two people posing together",
  selfie: "a selfie",
  decor: "decorations, flowers or table settings",
  venue: "a wide view of the room or the venue",
  outdoors: "outdoors",
  lights: "fireworks, sparklers or a light show",
  games: "games or sports",
  pets: "a pet or another animal",
  details: "a close-up of an object such as rings, shoes, an invitation or a gift",
  screenshot: "a screenshot, a document or a photo of a screen",
};

/** Shown on the scene chips. Spanish because the guest pages speak it (TRS-3). */
export const LABEL_NAMES: Record<"en" | "es", Record<SceneLabel, string>> = {
  en: {
    cake: "Cake",
    food: "Food",
    drinks: "Drinks",
    dancing: "Dancing",
    speech: "Speeches",
    ceremony: "Ceremony",
    performance: "Music",
    group: "Groups",
    portrait: "Portraits",
    couple: "Couples",
    selfie: "Selfies",
    decor: "Decor",
    venue: "The venue",
    outdoors: "Outdoors",
    lights: "Lights",
    games: "Games",
    pets: "Pets",
    details: "Details",
    screenshot: "Screenshots",
  },
  es: {
    cake: "Pastel",
    food: "Comida",
    drinks: "Bebidas",
    dancing: "Baile",
    speech: "Discursos",
    ceremony: "Ceremonia",
    performance: "Música",
    group: "Grupos",
    portrait: "Retratos",
    couple: "Parejas",
    selfie: "Selfis",
    decor: "Decoración",
    venue: "El lugar",
    outdoors: "Al aire libre",
    lights: "Luces",
    games: "Juegos",
    pets: "Mascotas",
    details: "Detalles",
    screenshot: "Capturas",
  },
};

/**
 * Words that mean a label, in English and Spanish, without accents. A search
 * for one of them also returns everything with the label, ahead of the
 * matches by meaning, because "cake" should find every photo of the cake and
 * not only the ones whose caption happens to say so.
 */
const LABEL_WORDS: Record<SceneLabel, string[]> = {
  cake: ["cake", "cakes", "dessert", "desserts", "pastel", "pasteles", "tarta", "torta", "postre", "postres"],
  food: ["food", "meal", "dinner", "lunch", "buffet", "comida", "cena", "almuerzo"],
  drinks: ["drink", "drinks", "toast", "bar", "cocktail", "cocktails", "champagne", "bebida", "bebidas", "brindis", "coctel"],
  dancing: ["dance", "dancing", "dancefloor", "baile", "bailando", "bailar"],
  speech: ["speech", "speeches", "toast", "microphone", "discurso", "discursos", "microfono"],
  ceremony: ["ceremony", "vows", "aisle", "altar", "rings", "ceremonia", "votos", "altar", "anillos"],
  performance: ["band", "dj", "music", "singer", "performance", "banda", "musica", "cantante"],
  group: ["group", "groups", "everyone", "grupo", "grupos", "todos"],
  portrait: ["portrait", "portraits", "retrato", "retratos"],
  couple: ["couple", "couples", "pareja", "parejas"],
  selfie: ["selfie", "selfies", "selfi", "selfis"],
  decor: ["decor", "decoration", "decorations", "flowers", "centerpiece", "decoracion", "flores"],
  venue: ["venue", "room", "hall", "salon", "lugar"],
  outdoors: ["outdoors", "outside", "garden", "beach", "exterior", "jardin", "playa", "afuera"],
  lights: ["fireworks", "sparklers", "lights", "fuegos", "bengalas", "luces"],
  games: ["games", "game", "sports", "juegos", "juego", "deportes"],
  pets: ["pet", "pets", "dog", "dogs", "cat", "cats", "mascota", "mascotas", "perro", "perros", "gato", "gatos"],
  details: ["details", "detail", "rings", "shoes", "invitation", "gift", "gifts", "detalles", "zapatos", "invitacion", "regalo", "regalos"],
  screenshot: ["screenshot", "screenshots", "screen", "document", "captura", "capturas", "pantalla"],
};

export const SYSTEM_PROMPT =
  "You label photos for a private event photo gallery so its hosts can search them. Answer with one JSON object and nothing else.";

export const USER_PROMPT = [
  "Describe this photo for search. Return JSON with exactly these keys:",
  '"caption": one plain sentence of at most 20 words saying what is in the photo. Describe people only by what they are doing and wearing. Never guess anyone\'s name, age, race, religion, health, sexuality or any other personal trait.',
  `"labels": every label from this list that clearly applies, or an empty list: ${SCENE_LABELS.map((label) => `${label} (${LABEL_MEANING[label]})`).join("; ")}.`,
  '"sexual_content": true if the photo shows nudity or sexual activity, otherwise false.',
  '"graphic_violence": true if it shows gore, serious injury, or a weapon being used against a person, otherwise false.',
  '"hate_symbol": true if it shows a hate symbol or a hateful gesture, otherwise false.',
].join("\n");

export const SAFETY_REASONS = ["sexual", "violence", "hate"] as const;
export type SafetyReason = (typeof SAFETY_REASONS)[number];

export interface Description {
  caption: string;
  labels: SceneLabel[];
  safety: "clear" | "flagged";
  reasons: SafetyReason[];
}

const flag = z.preprocess((value) => (value === "true" ? true : value === "false" ? false : value), z.boolean());

const answerSchema = z.object({
  caption: z.string().trim().min(1),
  labels: z.array(z.unknown()).default([]),
  sexual_content: flag,
  graphic_violence: flag,
  hate_symbol: flag,
});

const REFUSAL = /\b(i (can(no|')t|cannot|am unable|'m unable|am not able|'m not able|won'?t)|sorry|unable to (help|assist|describe))\b/i;

/** The first {...} in a reply, from a model that may wrap it in prose or a fence. */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/**
 * Reads the model's answer, which Workers AI hands back as a string or, for
 * some models, already parsed. Returns "refused" for a model that declined to
 * describe the photo (which for a vision model usually means it decided the
 * photo was not one to describe), and null for anything else unreadable, which
 * the job retries.
 */
export function parseDescription(raw: unknown): Description | "refused" | null {
  const value = typeof raw === "string" ? extractJson(raw) : raw;
  const parsed = answerSchema.safeParse(value);
  if (!parsed.success) {
    if (typeof raw === "string" && REFUSAL.test(raw) && extractJson(raw) === undefined) return "refused";
    return null;
  }
  const labels = [
    ...new Set(parsed.data.labels.map((label) => (typeof label === "string" ? label.trim().toLowerCase() : "")).filter(isSceneLabel)),
  ];
  const reasons: SafetyReason[] = [];
  if (parsed.data.sexual_content) reasons.push("sexual");
  if (parsed.data.graphic_violence) reasons.push("violence");
  if (parsed.data.hate_symbol) reasons.push("hate");
  return {
    // One sentence is asked for; a model that writes three is cut, not trusted.
    caption: parsed.data.caption.replace(/\s+/g, " ").slice(0, 200),
    labels,
    safety: reasons.length > 0 ? "flagged" : "clear",
    reasons,
  };
}

/** What gets embedded: the caption, then what its labels mean, so a search by
 * meaning also hears what the labels said. */
export function embeddingText(caption: string, labels: readonly SceneLabel[]): string {
  const meanings = labels.map((label) => LABEL_MEANING[label]);
  return meanings.length > 0 ? `${caption} ${meanings.join("; ")}` : caption;
}

function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** The labels a search names outright ("the cake" names cake). */
export function labelsForQuery(query: string): SceneLabel[] {
  const said = new Set(words(query));
  return SCENE_LABELS.filter((label) => LABEL_WORDS[label].some((word) => said.has(word)));
}

/** A search as it is embedded and cached: trimmed, one space, at most 120 characters. */
export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * How close a caption has to be to count as a match, as cosine similarity
 * between bge-m3 embeddings. First estimates from the model's published
 * behaviour on short sentences (unrelated ones sit near 0.3 to 0.45, related
 * ones above 0.55); they are the two numbers to tune once real searches run,
 * and nothing else depends on them.
 */
export const SEARCH_FLOOR = 0.45;
/** Results more than this far behind the best one are dropped as noise. */
export const SEARCH_SPAN = 0.15;
/** A photo with a label the search names outright goes this much further up. */
export const LABEL_BOOST = 0.15;
export const SEARCH_LIMIT = 60;

export interface Candidate {
  id: string;
  similarity: number;
  labels: readonly string[];
}

/**
 * Orders search candidates: the best match by meaning first, with a boost for
 * a label the query named, keeping only what is close enough to the best to be
 * worth a look. A label match is always kept, however its caption scored.
 */
export function rankCandidates(candidates: Candidate[], queryLabels: readonly SceneLabel[], limit = SEARCH_LIMIT): string[] {
  const scored = candidates.map((candidate) => {
    const named = queryLabels.some((label) => candidate.labels.includes(label));
    return { id: candidate.id, named, score: candidate.similarity + (named ? LABEL_BOOST : 0) };
  });
  const best = Math.max(-Infinity, ...scored.filter((item) => !item.named).map((item) => item.score));
  return scored
    .filter((item) => item.named || (item.score >= SEARCH_FLOOR && item.score >= best - SEARCH_SPAN))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.id);
}

/** A scene is offered once this many photos a viewer can see carry its label. */
export const MIN_SCENE_PHOTOS = 4;
/** And at most this many scenes, the biggest first. */
export const MAX_SCENES = 10;

/** AI-4: a smart folder's stored query. Moments are the other kind of smart album. */
export type SmartFolderQuery = { type: "search"; text: string } | { type: "scene"; label: SceneLabel };

export function parseSmartFolderQuery(query: unknown): SmartFolderQuery | null {
  if (!query || typeof query !== "object") return null;
  const value = query as { type?: unknown; text?: unknown; label?: unknown };
  if (value.type === "search" && typeof value.text === "string" && normalizeQuery(value.text)) {
    return { type: "search", text: normalizeQuery(value.text) };
  }
  if (value.type === "scene" && isSceneLabel(value.label)) return { type: "scene", label: value.label };
  return null;
}
