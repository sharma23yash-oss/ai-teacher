import type { HintLevel } from "./hint-ladder";

/**
 * Spaced repetition, SM-2 style (SuperMemo 2, Wozniak 1990), plus the daily
 * streak.
 *
 * Each concept has a review card. After each practice the card is graded
 * 0-5; a grade of 3 or more grows the gap before the next review (1 day,
 * 6 days, then x easiness), and a lower grade resets it to 1 day.
 */

export interface ReviewCard {
  key: string;
  label: string;
  topic: string;
  /** SM-2 easiness factor, never below 1.3. */
  easiness: number;
  /** Days between the last review and the next one. */
  intervalDays: number;
  /** Consecutive successful reviews. */
  repetitions: number;
  /** ISO timestamp when the next review is due. */
  dueAt: string;
  lastReviewedAt: string;
}

export type Quality = 0 | 1 | 2 | 3 | 4 | 5;

const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_EASINESS = 1.3;
export const DEFAULT_EASINESS = 2.5;

/** Map an answer to an SM-2 grade: unaided correct = 5; each hint rung lowers it; wrong = 1. */
export function qualityFromAnswer(correct: boolean, hintLevel: HintLevel): Quality {
  if (!correct) return 1;
  const byHint: Record<HintLevel, Quality> = { 0: 5, 1: 4, 2: 3, 3: 2, 4: 2 };
  return byHint[hintLevel];
}

export function newCard(key: string, label: string, topic: string, at: string): ReviewCard {
  return {
    key,
    label,
    topic,
    easiness: DEFAULT_EASINESS,
    intervalDays: 0,
    repetitions: 0,
    dueAt: at,
    lastReviewedAt: at,
  };
}

/** Grade one review. Pure: returns a new card. */
export function review(card: ReviewCard, quality: Quality, at: string): ReviewCard {
  const q = quality;
  const easiness = Math.max(
    MIN_EASINESS,
    card.easiness + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),
  );

  let repetitions: number;
  let intervalDays: number;
  if (q < 3) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    repetitions = card.repetitions + 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 6;
    else intervalDays = Math.round(card.intervalDays * easiness);
  }

  return {
    ...card,
    easiness: Math.round(easiness * 100) / 100,
    repetitions,
    intervalDays,
    lastReviewedAt: at,
    dueAt: new Date(Date.parse(at) + intervalDays * DAY_MS).toISOString(),
  };
}

export function isDue(card: ReviewCard, now: Date): boolean {
  return Date.parse(card.dueAt) <= now.getTime();
}

/** Minutes a single concept takes in the daily revision (one question plus feedback). */
export const MINUTES_PER_REVIEW = 2;
export const DAILY_REVISION_MINUTES = 10;

/**
 * Concepts due today, most overdue first, then weakest first, trimmed to fit
 * the 10-minute revision.
 */
export function dailyRevision(
  cards: ReviewCard[],
  now: Date,
  scoreOf: (key: string) => number = () => 0,
  minutes = DAILY_REVISION_MINUTES,
): ReviewCard[] {
  const limit = Math.max(1, Math.floor(minutes / MINUTES_PER_REVIEW));
  return cards
    .filter((card) => isDue(card, now))
    .sort((a, b) => {
      const overdue = Date.parse(a.dueAt) - Date.parse(b.dueAt);
      if (overdue !== 0) return overdue;
      return scoreOf(a.key) - scoreOf(b.key);
    })
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Streak
// ---------------------------------------------------------------------------

export interface StreakState {
  current: number;
  longest: number;
  /** Local calendar date (YYYY-MM-DD) of the last day with practice, or null. */
  lastActiveDate: string | null;
}

export const EMPTY_STREAK: StreakState = { current: 0, longest: 0, lastActiveDate: null };

/** YYYY-MM-DD in the user's local time zone (a streak follows the student's day, not UTC). */
export function localDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysBetween(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS);
}

/** Record practice on `today`. Same day: unchanged. Next day: +1. A gap: back to 1. */
export function recordActivity(state: StreakState, today: string): StreakState {
  if (state.lastActiveDate === today) return state;
  const gap = state.lastActiveDate ? daysBetween(state.lastActiveDate, today) : Infinity;
  if (gap < 0) return state; // clock moved backwards; ignore
  const current = gap === 1 ? state.current + 1 : 1;
  return { current, longest: Math.max(state.longest, current), lastActiveDate: today };
}

/** The streak as it should be shown today: 0 if the student missed yesterday. */
export function displayedStreak(state: StreakState, today: string): number {
  if (!state.lastActiveDate) return 0;
  const gap = daysBetween(state.lastActiveDate, today);
  return gap <= 1 ? state.current : 0;
}
