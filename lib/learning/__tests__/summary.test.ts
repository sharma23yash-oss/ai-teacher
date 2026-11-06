import { describe, expect, it } from "vitest";
import { conceptKey } from "../mastery";
import { emptyLearningState, recordEvidence } from "../state";
import { buildLessonSummary } from "../summary";

const now = new Date("2026-11-01T10:00:00.000Z");
const evidence = (label: string, correct: boolean) => ({
  key: conceptKey(label),
  label,
  topic: "Bonds",
  kind: "quiz" as const,
  correct,
  hintLevel: 0 as const,
  at: now.toISOString(),
});

describe("buildLessonSummary", () => {
  const state = recordEvidence(
    emptyLearningState(),
    [evidence("Coupon", true), evidence("Yield", false), evidence("Duration", true)],
    now,
  );

  it("splits the plan into learned, weak and remaining", () => {
    const summary = buildLessonSummary(
      "Bonds",
      [
        { label: "Coupon", status: "completed" },
        { label: "Yield", status: "completed" }, // completed but low mastery
        { label: "Duration", status: "misconception" },
        { label: "Convexity", status: "locked" },
      ],
      state,
      now,
    );
    expect(summary.learned.map((c) => c.label)).toEqual(["Coupon"]);
    expect(summary.weak.map((c) => c.label)).toEqual(["Yield", "Duration"]);
    expect(summary.remaining).toEqual(["Convexity"]);
    expect(summary.nextStep).toContain("Yield");
    expect(summary.streak).toBe(1);
  });

  it("suggests revision tomorrow when everything is learned", () => {
    const summary = buildLessonSummary("Bonds", [{ label: "Coupon", status: "completed" }], state, now);
    expect(summary.weak).toEqual([]);
    expect(summary.nextStep).toMatch(/tomorrow/);
  });

  it("treats concepts with no mastery record as learned when completed", () => {
    const summary = buildLessonSummary("X", [{ label: "New idea", status: "completed" }], emptyLearningState(), now);
    expect(summary.learned).toEqual([{ label: "New idea", percent: null }]);
  });
});
