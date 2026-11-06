import {
  applyEvidence,
  conceptKey,
  decayedScore,
  masteryBand,
  type ConceptMastery,
  type Evidence,
  type MasteryBand,
} from "./mastery";
import {
  dailyRevision,
  displayedStreak,
  EMPTY_STREAK,
  localDate,
  newCard,
  qualityFromAnswer,
  recordActivity,
  review,
  type ReviewCard,
  type StreakState,
} from "./spaced-repetition";

/**
 * Everything the learning engine remembers about one student, in one object.
 * Pure functions only: callers load it, pass it through recordEvidence, and
 * save the result (see lib/learning/storage.ts for the browser side).
 */
export interface LearningState {
  version: 1;
  concepts: Record<string, ConceptMastery>;
  cards: Record<string, ReviewCard>;
  streak: StreakState;
}

export function emptyLearningState(): LearningState {
  return { version: 1, concepts: {}, cards: {}, streak: EMPTY_STREAK };
}

/** Folds evidence into mastery, review cards and the streak. Several pieces for the same concept apply in order. */
export function recordEvidence(state: LearningState, evidence: Evidence[], now: Date): LearningState {
  if (evidence.length === 0) return state;
  const concepts = { ...state.concepts };
  const cards = { ...state.cards };
  for (const item of evidence) {
    if (!item.key) continue;
    concepts[item.key] = applyEvidence(concepts[item.key], item);
    const card = cards[item.key] ?? newCard(item.key, item.label, item.topic, item.at);
    cards[item.key] = review(
      { ...card, label: item.label, topic: item.topic || card.topic },
      qualityFromAnswer(item.correct, item.hintLevel),
      item.at,
    );
  }
  return {
    ...state,
    concepts,
    cards,
    streak: recordActivity(state.streak, localDate(now)),
  };
}

export interface MasteryView {
  /** Decayed to now, rounded to a whole percent. */
  percent: number;
  band: MasteryBand;
  confidence: number;
  attempts: number;
}

export function masteryFor(state: LearningState, label: string, now: Date): MasteryView | null {
  const record = state.concepts[conceptKey(label)];
  if (!record) return null;
  const percent = Math.round(decayedScore(record, now));
  return {
    percent,
    band: masteryBand(percent, record.attempts),
    confidence: record.confidence,
    attempts: record.attempts,
  };
}

export function revisionFor(state: LearningState, now: Date): ReviewCard[] {
  return dailyRevision(Object.values(state.cards), now, (key) => {
    const record = state.concepts[key];
    return record ? decayedScore(record, now) : 0;
  });
}

export function streakFor(state: LearningState, now: Date): number {
  return displayedStreak(state.streak, localDate(now));
}

/**
 * A few lines for the teaching prompt about which concepts this student finds
 * hard, so the teacher can check them first.
 */
export function masteryBriefing(state: LearningState, now: Date, limit = 6): string {
  const weakest = Object.values(state.concepts)
    .map((record) => ({ record, score: decayedScore(record, now) }))
    .filter(({ score }) => score < 70)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);
  if (weakest.length === 0) return "";
  const lines = weakest.map(
    ({ record, score }) =>
      `- "${record.label}" (${record.topic}): mastery ${Math.round(score)}%, ${record.attempts} attempts`,
  );
  return `Concepts this student has found hard (check these first when they come up):\n${lines.join("\n")}`;
}

/** Shape check for data read back from storage. */
export function isLearningState(value: unknown): value is LearningState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.concepts === "object" &&
    v.concepts !== null &&
    typeof v.cards === "object" &&
    v.cards !== null &&
    typeof v.streak === "object" &&
    v.streak !== null
  );
}
