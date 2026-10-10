import { describe, expect, it } from "vitest";
import { GUEST_COPY, refusalText, uploadRefusalText } from "./guest";
import { CURRENT_CONSENT, consentRecordId, consentShown, consentText, consentVersionById } from "../consent";

/** Every line of a dictionary, with functions called on sample arguments. */
function lines(value: unknown, path = ""): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (typeof value === "function") {
    const samples = [
      [1, "photo", "photo"],
      [3, "video", "video"],
      [2, "mixed"],
      ["Ana", 2, 5],
    ];
    return samples.map((args, index) => [`${path}#${index}`, String((value as (...a: unknown[]) => unknown)(...args))]);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => lines(child, path ? `${path}.${key}` : key));
  }
  return [];
}

// Words that are the same in both languages, or a brand.
const SAME_IN_BOTH = new Set(["Auto", "Original", "Noir", "Video", "Zoom", "Maya", "OK"]);

describe("TRS-3 guest dictionaries", () => {
  it("translates every line into Spanish", () => {
    const en = new Map(lines(GUEST_COPY.en));
    const untranslated = lines(GUEST_COPY.es)
      // A time like "5 s" or "2 min" is the same in both, numbers and units alike.
      .filter(([path, text]) => en.get(path) === text && !SAME_IN_BOTH.has(text) && !/^(\d|NaN)/.test(text))
      .map(([path]) => path);
    expect(untranslated).toEqual([]);
  });

  it("leaves no line empty, and writes no em dash", () => {
    for (const locale of ["en", "es"] as const) {
      for (const [path, text] of lines(GUEST_COPY[locale])) {
        expect(text.trim(), `${locale} ${path}`).not.toBe("");
        expect(text, `${locale} ${path}`).not.toContain("—");
      }
    }
  });

  it("agrees nouns in Spanish", () => {
    const es = GUEST_COPY.es.uploads;
    expect(es.offlineKept(1, "photo")).toContain("1 foto guardada");
    expect(es.offlineKept(2, "video")).toContain("2 videos guardados");
    expect(es.retryIn("5 s", true, 2, "photo")).toContain("Tus fotos están guardadas");
  });

  it("says a server's refusal in the guest's language, by its code", () => {
    const es = GUEST_COPY.es;
    expect(refusalText(es, { code: "wrong_password", error: "Incorrect password" }, "x")).toBe("Esa contraseña no es correcta.");
    expect(refusalText(es, { code: "nonsense", error: "Server words" }, "x")).toBe("Server words");
    expect(refusalText(es, null, "fallback")).toBe("fallback");
    expect(uploadRefusalText(es, { code: "too_large", values: { maxMb: 25 }, message: "File is too large" })).toContain("25 MB");
    expect(uploadRefusalText(es, { code: "video_too_long", values: { seconds: 60, actual: 95 }, message: "x" })).toBe(
      "Los videos pueden durar hasta 1:00. Este dura 1:35.",
    );
    expect(uploadRefusalText(es, { code: null, values: null, message: "Raw" })).toBe("Raw");
  });
});

describe("TRS-3 consent in Spanish", () => {
  it("records which language the agreement was shown in, and reads it back", () => {
    expect(consentRecordId("en")).toBe(CURRENT_CONSENT.id);
    expect(consentRecordId("es")).toBe(`${CURRENT_CONSENT.id}:es`);
    expect(consentVersionById(`${CURRENT_CONSENT.id}:es`)?.id).toBe(CURRENT_CONSENT.id);
    expect(consentShown(`${CURRENT_CONSENT.id}:es`)).toMatchObject({ locale: "es", statement: consentText(CURRENT_CONSENT, "es").statement });
    expect(consentShown(CURRENT_CONSENT.id)?.statement).toBe(CURRENT_CONSENT.statement);
    expect(consentText(CURRENT_CONSENT, "es").statement).toMatch(/^Entiendo/);
  });
});
