import { describe, expect, it } from "vitest";
import {
  dailyRevision,
  displayedStreak,
  EMPTY_STREAK,
  isDue,
  localDate,
  MIN_EASINESS,
  newCard,
  qualityFromAnswer,
  recordActivity,
  review,
} from "../spaced-repetition";

const T0 = "2026-11-01T10:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.parse(T0) + days * DAY).toISOString();

describe("SM-2 review", () => {
  it("follows the 1 day, 6 days, then x easiness schedule on good answers", () => {
    let card = newCard("k", "Ohm's Law", "Electricity", T0);
    card = review(card, 5, at(0));
    expect(card.intervalDays).toBe(1);
    card = review(card, 5, at(1));
    expect(card.intervalDays).toBe(6);
    card = review(card, 5, at(7));
    expect(card.intervalDays).toBe(Math.round(6 * card.easiness));
    expect(card.repetitions).toBe(3);
    expect(card.dueAt).toBe(at(7 + card.intervalDays));
  });

  it("resets to 1 day after a failed review", () => {
    let card = newCard("k", "x", "t", T0);
    card = review(card, 5, at(0));
    card = review(card, 5, at(1));
    card = review(card, 1, at(7));
    expect(card.repetitions).toBe(0);
    expect(card.intervalDays).toBe(1);
  });

  it("lowers easiness on hard answers but never below 1.3", () => {
    let card = newCard("k", "x", "t", T0);
    const start = card.easiness;
    card = review(card, 3, at(0));
    expect(card.easiness).toBeLessThan(start);
    for (let i = 0; i < 30; i++) card = review(card, 0, at(i));
    expect(card.easiness).toBe(MIN_EASINESS);
  });

  it("raises easiness on perfect answers", () => {
    const card = review(newCard("k", "x", "t", T0), 5, at(0));
    expect(card.easiness).toBeGreaterThan(2.5);
  });
});

describe("qualityFromAnswer", () => {
  it("grades unaided answers highest and hint-assisted answers lower", () => {
    expect(qualityFromAnswer(true, 0)).toBe(5);
    expect(qualityFromAnswer(true, 1)).toBe(4);
    expect(qualityFromAnswer(true, 2)).toBe(3);
    expect(qualityFromAnswer(true, 4)).toBeLessThan(3);
    expect(qualityFromAnswer(false, 0)).toBe(1);
  });
});

describe("dailyRevision", () => {
  const now = new Date(at(10));
  const card = (key: string, dueDay: number) => ({ ...newCard(key, key, "t", T0), dueAt: at(dueDay) });

  it("includes only due cards, most overdue first", () => {
    const cards = [card("later", 12), card("recent", 9), card("oldest", 2)];
    expect(dailyRevision(cards, now).map((c) => c.key)).toEqual(["oldest", "recent"]);
    expect(isDue(card("later", 12), now)).toBe(false);
  });

  it("breaks ties by weakest mastery first", () => {
    const cards = [card("strong", 5), card("weak", 5)];
    const scores: Record<string, number> = { strong: 90, weak: 20 };
    expect(dailyRevision(cards, now, (k) => scores[k]).map((c) => c.key)).toEqual(["weak", "strong"]);
  });

  it("fits a 10-minute session (5 concepts at 2 minutes each)", () => {
    const cards = Array.from({ length: 12 }, (_, i) => card(`c${i}`, i % 5));
    expect(dailyRevision(cards, now)).toHaveLength(5);
  });
});

describe("streak", () => {
  it("starts at 1, grows on consecutive days and ignores repeat visits the same day", () => {
    let s = recordActivity(EMPTY_STREAK, "2026-11-01");
    expect(s.current).toBe(1);
    s = recordActivity(s, "2026-11-01");
    expect(s.current).toBe(1);
    s = recordActivity(s, "2026-11-02");
    s = recordActivity(s, "2026-11-03");
    expect(s).toMatchObject({ current: 3, longest: 3 });
  });

  it("resets after a missed day but keeps the longest", () => {
    let s = recordActivity(EMPTY_STREAK, "2026-11-01");
    s = recordActivity(s, "2026-11-02");
    s = recordActivity(s, "2026-11-05");
    expect(s).toMatchObject({ current: 1, longest: 2 });
  });

  it("works across month and year boundaries", () => {
    let s = recordActivity(EMPTY_STREAK, "2026-12-31");
    s = recordActivity(s, "2027-01-01");
    expect(s.current).toBe(2);
  });

  it("shows 0 once a day has been missed, before the next practice", () => {
    const s = recordActivity(EMPTY_STREAK, "2026-11-01");
    expect(displayedStreak(s, "2026-11-01")).toBe(1);
    expect(displayedStreak(s, "2026-11-02")).toBe(1);
    expect(displayedStreak(s, "2026-11-03")).toBe(0);
  });

  it("formats local dates as YYYY-MM-DD", () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
