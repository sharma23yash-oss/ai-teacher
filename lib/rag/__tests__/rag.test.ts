import { describe, expect, it } from "vitest";
import { blocksFromPages, extractPlainText, formatLocator, looksLikeHeading } from "../blocks";
import { chunkBlocks, citationLabel } from "../chunking";
import { buildOutline, isMajorHeading } from "../outline";
import type { KnowledgeChunk } from "@/lib/types";

const para = (n: number, words = 30) => Array.from({ length: words }, (_, i) => `word${n}x${i}`).join(" ") + ".";

describe("formatLocator", () => {
  it("formats pages and slides, and nothing without a unit", () => {
    expect(formatLocator("page", 12)).toBe("p. 12");
    expect(formatLocator("page", 12, 13)).toBe("pp. 12–13");
    expect(formatLocator("slide", 4, 4)).toBe("slide 4");
    expect(formatLocator("slide", 4, 6)).toBe("slides 4–6");
    expect(formatLocator(null, 3)).toBeUndefined();
    expect(formatLocator("page", undefined)).toBeUndefined();
  });
});

describe("blocks", () => {
  it("detects headings conservatively", () => {
    expect(looksLikeHeading("Chapter 3 Valuation")).toBe(true);
    expect(looksLikeHeading("This is a normal sentence.")).toBe(false);
  });

  it("tags blocks with their page and carries a heading across a page break", () => {
    const blocks = blocksFromPages([
      { num: 2, text: `CHAPTER 2 BONDS\n\n${para(1)}` },
      { num: 3, text: para(2) },
    ]);
    const onPage3 = blocks.filter((b) => b.page === 3);
    expect(onPage3).toHaveLength(1);
    expect(onPage3[0].heading).toBe("CHAPTER 2 BONDS");
  });

  it("keeps plain text page-less", () => {
    expect(extractPlainText(para(1))[0].page).toBeUndefined();
  });
});

describe("chunkBlocks", () => {
  it("records page ranges and a locator on each chunk", () => {
    const blocks = [1, 2, 3, 4].map((page) => ({ heading: "Intro", text: para(page, 80), page }));
    const chunks = chunkBlocks(blocks, "page");
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.pageStart).toBeDefined();
      expect(chunk.locator).toMatch(/^pp?\. \d/);
    }
    expect(chunks[0].pageStart).toBe(1);
    expect(chunks[chunks.length - 1].pageEnd).toBe(4);
  });

  it("has no locator for documents without pages", () => {
    const [chunk] = chunkBlocks([{ text: para(1) }], null);
    expect(chunk.locator).toBeUndefined();
    expect(citationLabel(chunk)).toBe("passage 1");
  });

  it("labels citations with page then heading", () => {
    expect(citationLabel({ index: 3, locator: "p. 7", heading: "Duration" })).toBe("p. 7 · Duration");
  });
});

describe("buildOutline", () => {
  const chunk = (i: number, heading: string | undefined, page: number): KnowledgeChunk => ({
    id: `c${i}`, index: i, heading, text: "x", pageStart: page, pageEnd: page, locator: `p. ${page}`,
  });

  it("recognises major headings but not sub-sections or slide titles", () => {
    expect(isMajorHeading("Chapter 4: Valuation")).toBe(true);
    expect(isMajorHeading("UNIT II Economics")).toBe(true);
    expect(isMajorHeading("3. Corporate Actions")).toBe(true);
    expect(isMajorHeading("3.2 Bonus issues")).toBe(false);
    expect(isMajorHeading("Slide 4: Agenda")).toBe(false);
  });

  it("splits on major headings, folding sub-sections into their chapter", () => {
    const outline = buildOutline(
      [chunk(1, "Preface", 1), chunk(2, "Chapter 1 Markets", 2), chunk(3, "1.1 Equity", 3), chunk(4, "Chapter 2 Bonds", 5), chunk(5, "2.1 Yield", 6)],
      "page",
    );
    expect(outline.map((c) => c.title)).toEqual(["Introduction", "Chapter 1 Markets", "Chapter 2 Bonds"]);
    expect(outline[1]).toMatchObject({ pageStart: 2, pageEnd: 3, locator: "pp. 2–3", chunkIds: ["c2", "c3"] });
  });

  it("falls back to distinct headings", () => {
    const outline = buildOutline([chunk(1, "Alpha", 1), chunk(2, "Alpha", 2), chunk(3, "Beta", 3)], "page");
    expect(outline.map((c) => c.title)).toEqual(["Alpha", "Beta"]);
  });

  it("falls back to page-range groups when there are no usable headings", () => {
    const chunks = Array.from({ length: 20 }, (_, i) => chunk(i + 1, undefined, i + 1));
    const outline = buildOutline(chunks, "page");
    expect(outline.length).toBeGreaterThan(1);
    expect(outline[0].title).toMatch(/^Pages 1–/);
    expect(outline.flatMap((c) => c.chunkIds)).toHaveLength(20);
  });

  it("returns nothing for an empty document", () => {
    expect(buildOutline([], null)).toEqual([]);
  });
});
