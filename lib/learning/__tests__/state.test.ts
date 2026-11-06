import { describe, expect, it } from "vitest";
import { conceptKey, type Evidence } from "../mastery";
import {
  emptyLearningState,
  isLearningState,
  masteryBriefing,
  masteryFor,
  recordEvidence,
  revisionFor,
  streakFor,
} from "../state";

const now = new Date("2026-11-01T10:00:00.000Z");
const ev = (label: string, correct: boolean): Evidence => ({
  key: conceptKey(label),
  label,
  topic: "Electricity",
  kind: "quiz",
  correct,
  hintLevel: 0,
  at: now.toISOString(),
});

describe("recordEvidence", () => {
  it("updates mastery, schedules a review and starts the streak in one step", () => {
    const state = recordEvidence(emptyLearningState(), [ev("Ohm's Law", true), ev("Resistance", false)], now);
    expect(masteryFor(state, "Ohm's Law", now)?.percent).toBeGreaterThan(50);
    expect(masteryFor(state, "resistance", now)?.band).toBe("weak");
    expect(Object.keys(state.cards)).toHaveLength(2);
    expect(streakFor(state, now)).toBe(1);
  });

  it("returns the same object when there is no evidence", () => {
    const state = emptyLearningState();
    expect(recordEvidence(state, [], now)).toBe(state);
  });

  it("puts the wrong answer into tomorrow's revision", () => {
    const state = recordEvidence(emptyLearningState(), [ev("Resistance", false)], now);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expect(revisionFor(state, tomorrow).map((c) => c.label)).toEqual(["Resistance"]);
  });

  it("lists weak concepts for the prompt and nothing when all are strong", () => {
    const weak = recordEvidence(emptyLearningState(), [ev("Resistance", false)], now);
    expect(masteryBriefing(weak, now)).toContain("Resistance");
    expect(masteryBriefing(emptyLearningState(), now)).toBe("");
  });

  it("recognises stored state and rejects junk", () => {
    expect(isLearningState(emptyLearningState())).toBe(true);
    expect(isLearningState({ version: 2 })).toBe(false);
    expect(isLearningState(null)).toBe(false);
  });
});
