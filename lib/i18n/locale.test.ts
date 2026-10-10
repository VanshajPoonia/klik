import { describe, expect, it } from "vitest";
import { chooseLocale, fromAcceptLanguage } from "./locale";

describe("TRS-3 choosing a language", () => {
  it("reads the browser's ranked preferences", () => {
    expect(fromAcceptLanguage("es-MX,es;q=0.9,en;q=0.8")).toBe("es");
    expect(fromAcceptLanguage("fr-FR,fr;q=0.9,es;q=0.5")).toBe("es");
    expect(fromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
    expect(fromAcceptLanguage("de,fr")).toBeNull();
    expect(fromAcceptLanguage("es;q=0, en")).toBe("en");
    expect(fromAcceptLanguage(null)).toBeNull();
  });

  it("puts the guest's own choice first, then the host's, then the browser's", () => {
    expect(chooseLocale({ cookie: "en", eventLanguage: "es", acceptLanguage: "es" })).toBe("en");
    expect(chooseLocale({ eventLanguage: "es", acceptLanguage: "en" })).toBe("es");
    expect(chooseLocale({ eventLanguage: "auto", acceptLanguage: "es-US" })).toBe("es");
    expect(chooseLocale({ cookie: "xx", acceptLanguage: "de" })).toBe("en");
  });
});
