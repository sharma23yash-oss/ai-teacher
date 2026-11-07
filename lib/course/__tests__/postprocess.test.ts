import { describe, expect, it } from "vitest";
import type { KnowledgeChunk } from "@/lib/types";
import { citationFor, finaliseGrade, finaliseSummary, normaliseQuestions, numberedPassages } from "../postprocess";
import type { GeneratedQuestion } from "../schemas";

const passages: KnowledgeChunk[] = [
  { id: "c1", index: 1, text: "Bond prices fall when yields rise.", heading: "Bonds", locator: "p. 12", pageStart: 12, pageEnd: 12 },
  { id: "c2", index: 2, text: "Duration measures sensitivity.", heading: "Duration" },
];

const mcq = (over: Partial<GeneratedQuestion> = {}): GeneratedQuestion => ({
  type: "mcq", difficulty: "easy", concept: "Bond prices", question: "Q?", options: ["A", "B", "C", "D"],
  answerIndex: 1, explanation: "Because.", marks: 1, source: 1, ...over,
});

const desc = (over: Partial<GeneratedQuestion> = {}): GeneratedQuestion => ({
  type: "descriptive", difficulty: "medium", concept: "Duration", question: "Explain duration.", explanation: "E",
  marks: 5, modelAnswer: "M", markingScheme: [{ point: "Definition", marks: 2 }, { point: "Example", marks: 3 }], ...over,
});

describe("citationFor", () => {
  it("maps a passage number to its page and heading", () => {
    expect(citationFor(1, passages)).toEqual({ locator: "p. 12", heading: "Bonds" });
    expect(citationFor(2, passages)).toEqual({ heading: "Duration" });
  });

  it("drops invented or missing passage numbers", () => {
    expect(citationFor(7, passages)).toBeUndefined();
    expect(citationFor(0, passages)).toBeUndefined();
    expect(citationFor(undefined, passages)).toBeUndefined();
  });
});

describe("finaliseSummary", () => {
  it("attaches citations and drops an empty notCovered", () => {
    const summary = finaliseSummary(
      { overview: " O ", keyPoints: [{ point: "P", source: 1 }, { point: "Q", source: 9 }], notCovered: " " },
      passages,
      "Chapter 2",
    );
    expect(summary.keyPoints[0].citation?.locator).toBe("p. 12");
    expect(summary.keyPoints[1].citation).toBeUndefined();
    expect(summary.notCovered).toBeUndefined();
    expect(summary.overview).toBe("O");
  });
});

describe("normaliseQuestions", () => {
  it("keeps a valid MCQ with its citation", () => {
    const [q] = normaliseQuestions([mcq()], passages, "t");
    expect(q).toMatchObject({ id: "t-1", type: "mcq", answerIndex: 1, citation: { locator: "p. 12" } });
  });

  it("drops MCQs with a bad answer index, too few or duplicate options", () => {
    const out = normaliseQuestions(
      [mcq({ answerIndex: 4 }), mcq({ options: ["A"] }), mcq({ options: ["A", "a", "B", "C"] }), mcq({ answerIndex: undefined })],
      passages,
      "t",
    );
    expect(out).toEqual([]);
  });

  it("rescales a marking scheme so it adds up to the question's marks", () => {
    const [q] = normaliseQuestions(
      [desc({ marks: 5, markingScheme: [{ point: "A", marks: 1 }, { point: "B", marks: 1 }, { point: "C", marks: 1 }] })],
      passages,
      "t",
    );
    const total = q.markingScheme!.reduce((t, p) => t + p.marks, 0);
    expect(Math.round(total * 10) / 10).toBe(5);
  });

  it("drops a descriptive question with no marking scheme", () => {
    expect(normaliseQuestions([desc({ markingScheme: [] })], passages, "t")).toEqual([]);
  });
});

describe("finaliseGrade", () => {
  const scheme = [{ point: "Definition", marks: 2 }, { point: "Example", marks: 3 }];

  it("clamps each point to its maximum and computes the total itself", () => {
    const grade = finaliseGrade(
      { points: [{ point: "x", awarded: 5, comment: "great" }, { point: "y", awarded: -1, comment: "missing" }], feedback: "F", improve: "I" },
      scheme,
    );
    expect(grade.points.map((p) => p.awarded)).toEqual([2, 0]);
    expect(grade.total).toBe(2);
    expect(grade.max).toBe(5);
  });

  it("rounds to half marks and fills in unmarked points as zero", () => {
    const grade = finaliseGrade({ points: [{ point: "x", awarded: 1.3, comment: "" }], feedback: "F", improve: "" }, scheme);
    expect(grade.points[0].awarded).toBe(1.5);
    expect(grade.points[1]).toMatchObject({ awarded: 0, comment: "Not addressed." });
    expect(grade.total).toBe(1.5);
  });
});

describe("numberedPassages", () => {
  it("numbers passages from 1 with their labels inside untrusted_context", () => {
    const text = numberedPassages(passages);
    expect(text).toContain("[1 · p. 12 · Bonds]");
    expect(text).toContain("[2 · Duration]");
    expect(text.startsWith("<untrusted_context>")).toBe(true);
  });
});
