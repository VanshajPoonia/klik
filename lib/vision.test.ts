import { describe, expect, it } from "vitest";
import {
  SCENE_LABELS,
  SEARCH_FLOOR,
  USER_PROMPT,
  embeddingText,
  labelsForQuery,
  normalizeQuery,
  parseDescription,
  parseSmartFolderQuery,
  rankCandidates,
} from "./vision";

const answer = (overrides: Record<string, unknown> = {}) => ({
  caption: "Two people dancing",
  labels: ["dancing"],
  sexual_content: false,
  graphic_violence: false,
  hate_symbol: false,
  ...overrides,
});

describe("reading the model's answer", () => {
  it("takes an object or a string, with or without a fence or a preamble", () => {
    expect(parseDescription(answer())).toMatchObject({ caption: "Two people dancing", labels: ["dancing"], safety: "clear" });
    expect(parseDescription(JSON.stringify(answer()))).toMatchObject({ labels: ["dancing"] });
    expect(parseDescription(`Here you go:\n\`\`\`json\n${JSON.stringify(answer())}\n\`\`\``)).toMatchObject({ safety: "clear" });
  });

  it("keeps only known labels, once each, lower-cased", () => {
    expect(parseDescription(answer({ labels: ["Dancing", "dancing", "UFO", 7, "lights"] }))).toMatchObject({
      labels: ["dancing", "lights"],
    });
  });

  it("flags on any of the three questions, with each reason named", () => {
    expect(parseDescription(answer({ sexual_content: true, hate_symbol: "true" }))).toMatchObject({
      safety: "flagged",
      reasons: ["sexual", "hate"],
    });
  });

  it("cuts a rambling caption rather than trusting it, and folds its whitespace", () => {
    const parsed = parseDescription(answer({ caption: `A  room\n${"word ".repeat(100)}` }));
    expect(parsed && parsed !== "refused" ? parsed.caption.length : 0).toBe(200);
    expect(parsed && parsed !== "refused" ? parsed.caption.startsWith("A room word") : false).toBe(true);
  });

  it("tells a refusal from an answer it could not read", () => {
    expect(parseDescription("I'm sorry, but I can't help with that image.")).toBe("refused");
    expect(parseDescription("I cannot describe this photo.")).toBe("refused");
    expect(parseDescription("{ caption: broken")).toBeNull();
    expect(parseDescription(answer({ sexual_content: undefined }))).toBeNull();
    expect(parseDescription(null)).toBeNull();
  });
});

describe("the prompt", () => {
  it("offers every label and forbids guessing who people are", () => {
    for (const label of SCENE_LABELS) expect(USER_PROMPT).toContain(`${label} (`);
    expect(USER_PROMPT).toMatch(/Never guess anyone's name, age, race/);
  });
});

describe("queries", () => {
  it("names labels in English and Spanish, accents or not", () => {
    expect(labelsForQuery("the CAKE")).toEqual(["cake"]);
    expect(labelsForQuery("el pastel")).toEqual(["cake"]);
    expect(labelsForQuery("baile y música")).toEqual(["dancing", "performance"]);
    expect(labelsForQuery("Anita's hat")).toEqual([]);
  });

  it("are trimmed to one line of at most 120 characters", () => {
    expect(normalizeQuery("  the   cake \n ")).toBe("the cake");
    expect(normalizeQuery("x".repeat(500))).toHaveLength(120);
  });

  it("embed a caption with what its labels mean", () => {
    expect(embeddingText("A table", ["cake"])).toBe("A table a cake or a dessert table");
    expect(embeddingText("A table", [])).toBe("A table");
  });
});

describe("ranking", () => {
  it("keeps what is close to the best match and drops the long tail", () => {
    const ids = rankCandidates(
      [
        { id: "best", similarity: 0.8, labels: [] },
        { id: "near", similarity: 0.7, labels: [] },
        { id: "far", similarity: 0.6, labels: [] },
        { id: "weak", similarity: SEARCH_FLOOR - 0.01, labels: [] },
      ],
      [],
    );
    expect(ids).toEqual(["best", "near"]);
  });

  it("always keeps a photo with a label the query named, and lifts it", () => {
    const ids = rankCandidates(
      [
        { id: "caption", similarity: 0.7, labels: [] },
        { id: "labelled", similarity: 0.6, labels: ["cake"] },
        { id: "labelled-poorly", similarity: 0.1, labels: ["cake"] },
      ],
      ["cake"],
    );
    expect(ids).toEqual(["labelled", "caption", "labelled-poorly"]);
  });

  it("finds nothing when nothing is close", () => {
    expect(rankCandidates([{ id: "a", similarity: 0.2, labels: [] }], [])).toEqual([]);
  });
});

describe("a smart folder's query", () => {
  it("is a search or a scene, and anything else is not one", () => {
    expect(parseSmartFolderQuery({ type: "search", text: "  the cake " })).toEqual({ type: "search", text: "the cake" });
    expect(parseSmartFolderQuery({ type: "scene", label: "dancing" })).toEqual({ type: "scene", label: "dancing" });
    expect(parseSmartFolderQuery({ type: "scene", label: "ufo" })).toBeNull();
    expect(parseSmartFolderQuery({ type: "moment", start: "x", end: "y" })).toBeNull();
    expect(parseSmartFolderQuery({ type: "search", text: "   " })).toBeNull();
    expect(parseSmartFolderQuery(null)).toBeNull();
  });
});
