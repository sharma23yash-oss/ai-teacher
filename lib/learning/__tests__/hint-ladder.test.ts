import { describe, expect, it } from "vitest";
import {
  clampHintLevel,
  HINT_CREDIT,
  hintCredit,
  hintLevelName,
  MAX_HINT_LEVEL,
  nextHintLevel,
} from "../hint-ladder";

describe("hint ladder", () => {
  it("climbs one rung at a time: nudge -> hint -> worked step -> full solution", () => {
    expect(nextHintLevel(0)).toBe(1);
    expect(nextHintLevel(1)).toBe(2);
    expect(nextHintLevel(2)).toBe(3);
    expect(nextHintLevel(3)).toBe(4);
    expect([1, 2, 3, 4].map((l) => hintLevelName(l as 1))).toEqual([
      "nudge",
      "hint",
      "worked_step",
      "full_solution",
    ]);
  });

  it("stops after the full solution", () => {
    expect(nextHintLevel(MAX_HINT_LEVEL)).toBeNull();
  });

  it("gives less credit the more help was used", () => {
    const credits = [0, 1, 2, 3, 4].map((l) => hintCredit(l as 0));
    for (let i = 1; i < credits.length; i++) expect(credits[i]).toBeLessThan(credits[i - 1]);
    expect(credits[0]).toBe(1);
    expect(credits[4]).toBeGreaterThan(0);
  });

  it("clamps out-of-range levels", () => {
    expect(clampHintLevel(-2)).toBe(0);
    expect(clampHintLevel(Number.NaN)).toBe(0);
    expect(clampHintLevel(2.7)).toBe(2);
    expect(clampHintLevel(9)).toBe(4);
    expect(hintCredit(9 as 4)).toBe(HINT_CREDIT[4]);
  });
});
