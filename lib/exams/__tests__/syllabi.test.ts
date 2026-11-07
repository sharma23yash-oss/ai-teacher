import { describe, expect, it } from "vitest";
import { EXAM_PRESETS } from "@/lib/types";
import { pickChapterByWeight, syllabusBriefing, syllabusFor, weightageLabel } from "../syllabi";

const chapter = (id: string, weightagePercent: number | null, weightageRange: [number, number] | null = null) => ({
  id, title: id, weightagePercent, weightageRange, topics: [],
});

describe("syllabusFor", () => {
  it("has a syllabus for every exam preset", () => {
    for (const preset of EXAM_PRESETS) expect(syllabusFor(preset)?.chapters.length).toBeGreaterThan(0);
  });
});

describe("weightageLabel", () => {
  it("shows exact, range or nothing", () => {
    expect(weightageLabel(chapter("a", 18))).toBe("18%");
    expect(weightageLabel(chapter("a", null, [15, 20]))).toBe("15–20%");
    expect(weightageLabel(chapter("a", null))).toBeNull();
  });
});

describe("syllabusBriefing", () => {
  it("flags unverified maps so the teacher doesn't present them as official", () => {
    expect(syllabusBriefing(syllabusFor("nism")!)).toMatch(/UNVERIFIED/);
  });

  it("includes CFA's weight ranges", () => {
    expect(syllabusBriefing(syllabusFor("cfa")!)).toContain("Ethical and Professional Standards (weightage 15–20%)");
  });
});

describe("pickChapterByWeight", () => {
  it("picks in proportion to weight", () => {
    const chapters = [chapter("small", 10), chapter("big", 90)];
    expect(pickChapterByWeight(chapters, () => 0.05)?.id).toBe("small");
    expect(pickChapterByWeight(chapters, () => 0.5)?.id).toBe("big");
    expect(pickChapterByWeight(chapters, () => 0.999)?.id).toBe("big");
  });

  it("uses range midpoints and spreads evenly when nothing is filled in", () => {
    expect(pickChapterByWeight([chapter("a", null, [0, 20]), chapter("b", null, [40, 60])], () => 0.1)?.id).toBe("a");
    const even = [chapter("a", null), chapter("b", null)];
    expect(pickChapterByWeight(even, () => 0.49)?.id).toBe("a");
    expect(pickChapterByWeight(even, () => 0.51)?.id).toBe("b");
  });

  it("returns null for no chapters", () => {
    expect(pickChapterByWeight([], () => 0.5)).toBeNull();
  });
});
