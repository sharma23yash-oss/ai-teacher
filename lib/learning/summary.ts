import { masteryFor, streakFor, type LearningState } from "./state";

/** What the end-of-lesson card shows. Built from the lesson plan plus the stored mastery. */
export interface LessonSummary {
  topic: string;
  learned: { label: string; percent: number | null }[];
  weak: { label: string; percent: number | null }[];
  /** Concepts not reached yet (locked or still current). */
  remaining: string[];
  nextStep: string;
  streak: number;
}

/** Below this mastery a completed concept still counts as a weak spot. */
export const WEAK_BELOW_PERCENT = 50;

export function buildLessonSummary(
  topic: string,
  plan: { label: string; status: string }[],
  state: LearningState,
  now: Date,
): LessonSummary {
  const learned: LessonSummary["learned"] = [];
  const weak: LessonSummary["weak"] = [];
  const remaining: string[] = [];

  for (const concept of plan) {
    const percent = masteryFor(state, concept.label, now)?.percent ?? null;
    if (concept.status === "misconception") {
      weak.push({ label: concept.label, percent });
    } else if (concept.status === "completed") {
      if (percent !== null && percent < WEAK_BELOW_PERCENT) weak.push({ label: concept.label, percent });
      else learned.push({ label: concept.label, percent });
    } else {
      remaining.push(concept.label);
    }
  }

  let nextStep: string;
  if (weak.length > 0) {
    nextStep = `Practise "${weak[0].label}" again. Use the Hint button if you get stuck.`;
  } else if (remaining.length > 0) {
    nextStep = `Carry on with "${remaining[0]}".`;
  } else {
    nextStep = "Come back tomorrow for a 10-minute revision to lock this in.";
  }

  return { topic, learned, weak, remaining, nextStep, streak: streakFor(state, now) };
}
