import { hintCredit, type HintLevel } from "./hint-ladder";

/**
 * Per-concept mastery model.
 *
 * Each concept carries a score (0-100), a confidence (0-1: how much evidence
 * the score rests on), and the time it was last practised. Every piece of
 * evidence (a quiz answer, a Socratic question, a teach-back) pulls the score
 * toward a target: 100 x hint credit for a correct answer, 0 for a wrong one.
 * Early evidence moves the score a lot; later evidence less, as confidence
 * grows. Between practice sessions the score decays (forgetting), more slowly
 * for concepts the student has shown many times.
 */

export type EvidenceKind = "quiz" | "socratic" | "teachback";

export interface Evidence {
  /** Stable concept key (see conceptKey). */
  key: string;
  label: string;
  topic: string;
  kind: EvidenceKind;
  correct: boolean;
  /** Highest hint rung used before this answer. */
  hintLevel: HintLevel;
  /** ISO timestamp. */
  at: string;
}

export interface ConceptMastery {
  key: string;
  label: string;
  topic: string;
  /** 0-100, as of lastPractisedAt (before decay). */
  score: number;
  /** 0-1: how much evidence backs the score. */
  confidence: number;
  attempts: number;
  correct: number;
  /** Total hint rungs used across attempts. */
  hintsUsed: number;
  lastPractisedAt: string;
}

/** How strongly one piece of evidence of each kind moves the score. */
export const EVIDENCE_WEIGHT: Record<EvidenceKind, number> = {
  quiz: 0.45,
  teachback: 0.4,
  socratic: 0.3,
};

/** Fraction of a learned score that is never forgotten. */
export const DECAY_FLOOR = 0.4;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Lower-case, accent-free, punctuation-free label, so the same concept from two lessons maps to one record. */
export function conceptKey(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^\s*\d+[.)]\s*/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function newMastery(key: string, label: string, topic: string, at: string): ConceptMastery {
  return {
    key,
    label,
    topic,
    score: 0,
    confidence: 0,
    attempts: 0,
    correct: 0,
    hintsUsed: 0,
    lastPractisedAt: at,
  };
}

/** Confidence grows with attempts: 1 → 0.25, 3 → 0.5, 9 → 0.75. */
export function confidenceFor(attempts: number): number {
  return attempts <= 0 ? 0 : attempts / (attempts + 3);
}

/** Days until an un-practised score loses half of its forgettable part. Grows with confidence: 2 to 30 days. */
export function halfLifeDays(confidence: number): number {
  return 2 + 28 * Math.min(1, Math.max(0, confidence));
}

/** Score after forgetting, at time `now`. Never below DECAY_FLOOR of the stored score. */
export function decayedScore(record: ConceptMastery, now: Date): number {
  const elapsedDays = Math.max(0, (now.getTime() - Date.parse(record.lastPractisedAt)) / DAY_MS);
  const retained = Math.pow(0.5, elapsedDays / halfLifeDays(record.confidence));
  return record.score * (DECAY_FLOOR + (1 - DECAY_FLOOR) * retained);
}

/** Apply one piece of evidence. Pure: returns a new record. */
export function applyEvidence(
  record: ConceptMastery | undefined,
  evidence: Evidence,
): ConceptMastery {
  const now = new Date(evidence.at);
  const base = record ?? newMastery(evidence.key, evidence.label, evidence.topic, evidence.at);
  const current = record ? decayedScore(base, now) : 0;

  const target = evidence.correct ? 100 * hintCredit(evidence.hintLevel) : 0;
  // New concepts move fast; well-evidenced ones need more to shift.
  const rate = EVIDENCE_WEIGHT[evidence.kind] * (1 - 0.5 * base.confidence) + (record ? 0 : 0.15);
  const score = clamp(current + rate * (target - current), 0, 100);
  const attempts = base.attempts + 1;

  return {
    ...base,
    label: evidence.label,
    topic: evidence.topic || base.topic,
    score: round1(score),
    confidence: round2(confidenceFor(attempts)),
    attempts,
    correct: base.correct + (evidence.correct ? 1 : 0),
    hintsUsed: base.hintsUsed + evidence.hintLevel,
    lastPractisedAt: evidence.at,
  };
}

export type MasteryBand = "new" | "weak" | "developing" | "proficient" | "mastered";

export function masteryBand(score: number, attempts: number): MasteryBand {
  if (attempts === 0) return "new";
  if (score >= 90) return "mastered";
  if (score >= 70) return "proficient";
  if (score >= 40) return "developing";
  return "weak";
}

/** Status changes between two concept plans, as evidence. A concept that became "completed" was answered well; one that became "misconception" was answered wrongly. */
export function evidenceFromPlanChange(
  previous: { id: string; label: string; status: string }[],
  next: { id: string; label: string; status: string }[],
  context: { topic: string; kind: EvidenceKind; hintLevel: HintLevel; at: string },
): Evidence[] {
  const before = new Map(previous.map((concept) => [concept.id, concept.status]));
  const out: Evidence[] = [];
  for (const concept of next) {
    const was = before.get(concept.id);
    if (was === concept.status) continue;
    if (concept.status !== "completed" && concept.status !== "misconception") continue;
    // A concept that was never seen before and arrives already completed is
    // the model's plan, not something the student did.
    if (was === undefined || was === "locked") continue;
    out.push({
      key: conceptKey(concept.label),
      label: concept.label,
      topic: context.topic,
      kind: context.kind,
      correct: concept.status === "completed",
      hintLevel: context.hintLevel,
      at: context.at,
    });
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
