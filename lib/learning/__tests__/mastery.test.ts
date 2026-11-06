import { describe, expect, it } from "vitest";
import {
  applyEvidence,
  conceptKey,
  confidenceFor,
  DECAY_FLOOR,
  decayedScore,
  evidenceFromPlanChange,
  masteryBand,
  type Evidence,
} from "../mastery";
import type { HintLevel } from "../hint-ladder";

const T0 = "2026-11-01T10:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;
const later = (days: number) => new Date(Date.parse(T0) + days * DAY).toISOString();

function ev(correct: boolean, opts: Partial<Evidence> = {}): Evidence {
  return {
    key: "ohm s law",
    label: "Ohm's Law",
    topic: "Electricity",
    kind: "quiz",
    correct,
    hintLevel: 0,
    at: T0,
    ...opts,
  };
}

describe("conceptKey", () => {
  it("treats the same concept with different punctuation, case and numbering as one", () => {
    expect(conceptKey("2. Ohm's Law")).toBe(conceptKey("ohm’s law"));
    expect(conceptKey("  Résistance ")).toBe("resistance");
  });

  it("keeps non-Latin scripts", () => {
    expect(conceptKey("प्रकाश संश्लेषण")).not.toBe("");
  });
});

describe("applyEvidence", () => {
  it("starts a new concept from the first answer", () => {
    const right = applyEvidence(undefined, ev(true));
    const wrong = applyEvidence(undefined, ev(false));
    expect(right.score).toBeGreaterThan(50);
    expect(wrong.score).toBe(0);
    expect(right.attempts).toBe(1);
    expect(right.lastPractisedAt).toBe(T0);
  });

  it("keeps the score between 0 and 100", () => {
    let record = applyEvidence(undefined, ev(true));
    for (let i = 0; i < 50; i++) record = applyEvidence(record, ev(true));
    expect(record.score).toBeLessThanOrEqual(100);
    for (let i = 0; i < 50; i++) record = applyEvidence(record, ev(false));
    expect(record.score).toBeGreaterThanOrEqual(0);
  });

  it("rises with repeated correct answers and falls after a wrong one", () => {
    let record = applyEvidence(undefined, ev(true));
    const first = record.score;
    record = applyEvidence(record, ev(true));
    expect(record.score).toBeGreaterThan(first);
    const beforeWrong = record.score;
    record = applyEvidence(record, ev(false));
    expect(record.score).toBeLessThan(beforeWrong);
  });

  it("factors the hint ladder in: more help, less credit", () => {
    const scores = ([0, 1, 2, 3, 4] as HintLevel[]).map(
      (hintLevel) => applyEvidence(undefined, ev(true, { hintLevel })).score,
    );
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThan(scores[i - 1]);
    const record = applyEvidence(undefined, ev(true, { hintLevel: 3 }));
    expect(record.hintsUsed).toBe(3);
  });

  it("weights a quiz answer more than a Socratic answer", () => {
    const quiz = applyEvidence(undefined, ev(true, { kind: "quiz" }));
    const socratic = applyEvidence(undefined, ev(true, { kind: "socratic" }));
    expect(quiz.score).toBeGreaterThan(socratic.score);
  });

  it("builds confidence with attempts", () => {
    expect(confidenceFor(0)).toBe(0);
    expect(confidenceFor(1)).toBeLessThan(confidenceFor(5));
    let record = applyEvidence(undefined, ev(true));
    const c1 = record.confidence;
    record = applyEvidence(record, ev(true));
    expect(record.confidence).toBeGreaterThan(c1);
  });
});

describe("decay", () => {
  it("does not decay on the same day", () => {
    const record = applyEvidence(undefined, ev(true));
    expect(decayedScore(record, new Date(T0))).toBeCloseTo(record.score);
  });

  it("forgets over time but never below the floor", () => {
    const record = applyEvidence(undefined, ev(true));
    const week = decayedScore(record, new Date(later(7)));
    const year = decayedScore(record, new Date(later(365)));
    expect(week).toBeLessThan(record.score);
    expect(year).toBeLessThan(week);
    expect(year).toBeGreaterThanOrEqual(record.score * DECAY_FLOOR - 0.01);
  });

  it("forgets more slowly once a concept has been practised many times", () => {
    const once = applyEvidence(undefined, ev(true));
    let many = once;
    for (let i = 0; i < 8; i++) many = applyEvidence(many, ev(true));
    const keptOnce = decayedScore(once, new Date(later(10))) / once.score;
    const keptMany = decayedScore(many, new Date(later(10))) / many.score;
    expect(keptMany).toBeGreaterThan(keptOnce);
  });

  it("applies decay before new evidence", () => {
    const record = applyEvidence(undefined, ev(true));
    const fresh = applyEvidence(record, ev(true, { at: T0 }));
    const stale = applyEvidence(record, ev(true, { at: later(30) }));
    expect(stale.score).toBeLessThan(fresh.score);
  });
});

describe("masteryBand", () => {
  it("maps scores to bands", () => {
    expect(masteryBand(0, 0)).toBe("new");
    expect(masteryBand(20, 1)).toBe("weak");
    expect(masteryBand(55, 2)).toBe("developing");
    expect(masteryBand(75, 3)).toBe("proficient");
    expect(masteryBand(95, 4)).toBe("mastered");
  });
});

describe("evidenceFromPlanChange", () => {
  const ctx = { topic: "Electricity", kind: "socratic" as const, hintLevel: 2 as HintLevel, at: T0 };

  it("turns current -> completed into a correct answer and current -> misconception into a wrong one", () => {
    const before = [
      { id: "a", label: "Voltage", status: "current" },
      { id: "b", label: "Current", status: "current" },
    ];
    const after = [
      { id: "a", label: "Voltage", status: "completed" },
      { id: "b", label: "Current", status: "misconception" },
    ];
    const out = evidenceFromPlanChange(before, after, ctx);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ label: "Voltage", correct: true, hintLevel: 2, kind: "socratic" });
    expect(out[1]).toMatchObject({ label: "Current", correct: false });
  });

  it("ignores unchanged concepts, newly planned ones and unlocks", () => {
    const before = [{ id: "a", label: "Voltage", status: "completed" }, { id: "c", label: "Power", status: "locked" }];
    const after = [
      { id: "a", label: "Voltage", status: "completed" },
      { id: "c", label: "Power", status: "current" },
      { id: "d", label: "Energy", status: "completed" },
    ];
    expect(evidenceFromPlanChange(before, after, ctx)).toEqual([]);
  });
});
