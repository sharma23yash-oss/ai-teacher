"use client";

import {
  type ConceptNode,
  type Language,
  type LearnerLevel,
  type LearnerProfileRecord,
  type QuizReport,
  type TeacherPersona,
  type TimeBudget,
  type TopicRecord,
} from "./types";

/**
 * The persistent learner profile (section 14 of the brief).
 *
 * Everything the tutor learns about a student — what they have studied, what
 * they scored, which concepts keep tripping them up, and how they like to be
 * taught — is written here and reloaded on the next visit, so a second
 * session starts from what the first one found out rather than from zero.
 *
 * It lives in localStorage. That is a deliberate choice, not a shortcut:
 * there are no accounts in this app, so there is no server-side identity to
 * key a database row on, and a learner's study history is the kind of thing
 * that should stay on their own machine by default. Every read and write is
 * wrapped — private-mode browsers throw on access rather than returning null,
 * and a corrupted entry must never be able to stop a lesson from loading.
 */

const STORAGE_KEY = "ai-teacher.learner-profile.v1";
const MAX_HISTORY = 60;
const MAX_TOPICS = 40;

function emptyProfile(): LearnerProfileRecord {
  const now = new Date().toISOString();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    preferredLanguage: "english",
    preferredLevel: "beginner",
    preferredPersona: "standard",
    preferredTimeBudget: "standard",
    topics: [],
    history: [],
  };
}

function isProfile(value: unknown): value is LearnerProfileRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && Array.isArray(v.topics) && Array.isArray(v.history);
}

export function loadProfile(): LearnerProfileRecord {
  if (typeof window === "undefined") return emptyProfile();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProfile();
    const parsed: unknown = JSON.parse(raw);
    // A profile written by a future version, or hand-edited into nonsense,
    // is replaced rather than allowed to crash the app on first render.
    return isProfile(parsed) ? parsed : emptyProfile();
  } catch {
    return emptyProfile();
  }
}

export function saveProfile(profile: LearnerProfileRecord): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Quota exceeded, or storage blocked entirely. The session keeps working;
    // it just won't be remembered next time.
  }
}

export function clearProfile(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}

function touch(profile: LearnerProfileRecord): LearnerProfileRecord {
  return { ...profile, updatedAt: new Date().toISOString() };
}

function addHistory(
  profile: LearnerProfileRecord,
  entry: LearnerProfileRecord["history"][number],
): LearnerProfileRecord {
  return { ...profile, history: [entry, ...profile.history].slice(0, MAX_HISTORY) };
}

function upsertTopic(
  profile: LearnerProfileRecord,
  topic: string,
  update: (record: TopicRecord) => TopicRecord,
): LearnerProfileRecord {
  const key = topic.trim();
  if (!key) return profile;

  const existing = profile.topics.find(
    (record) => record.topic.toLowerCase() === key.toLowerCase(),
  );
  const base: TopicRecord = existing ?? {
    topic: key,
    lastStudiedAt: new Date().toISOString(),
    sessions: 0,
    conceptsCompleted: [],
    conceptsWeak: [],
    scores: [],
  };

  const updated = update({ ...base, lastStudiedAt: new Date().toISOString() });
  const others = profile.topics.filter((record) => record !== existing);

  return { ...profile, topics: [updated, ...others].slice(0, MAX_TOPICS) };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

// ---------------------------------------------------------------------------
// Events the app records
// ---------------------------------------------------------------------------

export interface PreferenceSnapshot {
  language: Language;
  level: LearnerLevel;
  persona: TeacherPersona;
  timeBudget: TimeBudget;
}

export function recordPreferences(
  profile: LearnerProfileRecord,
  preferences: PreferenceSnapshot,
): LearnerProfileRecord {
  return touch({
    ...profile,
    preferredLanguage: preferences.language,
    preferredLevel: preferences.level,
    preferredPersona: preferences.persona,
    preferredTimeBudget: preferences.timeBudget,
  });
}

/** Called whenever the engine returns a concept plan for a topic. */
export function recordLessonProgress(
  profile: LearnerProfileRecord,
  topic: string,
  conceptPlan: ConceptNode[],
  isNewTopic: boolean,
): LearnerProfileRecord {
  const completed = conceptPlan.filter((c) => c.status === "completed").map((c) => c.label);
  const weak = conceptPlan.filter((c) => c.status === "misconception").map((c) => c.label);

  let next = upsertTopic(profile, topic, (record) => ({
    ...record,
    sessions: record.sessions + (isNewTopic ? 1 : 0),
    conceptsCompleted: unique([...record.conceptsCompleted, ...completed]),
    // A concept the student has since mastered stops counting as weak.
    conceptsWeak: unique([...record.conceptsWeak, ...weak]).filter(
      (label) => !completed.includes(label),
    ),
  }));

  if (isNewTopic) {
    next = addHistory(next, {
      at: new Date().toISOString(),
      topic,
      kind: "lesson",
      detail: `Started a lesson — ${conceptPlan.length} concepts planned`,
    });
  }

  return touch(next);
}

export function recordQuizResult(
  profile: LearnerProfileRecord,
  topic: string,
  report: QuizReport,
): LearnerProfileRecord {
  const next = upsertTopic(profile, topic, (record) => ({
    ...record,
    scores: [...record.scores, report.scorePercent].slice(-20),
    conceptsWeak: unique([...record.conceptsWeak, ...report.weakConcepts]),
    conceptsCompleted: unique([...record.conceptsCompleted, ...report.masteredConcepts]).filter(
      (label) => !report.weakConcepts.includes(label),
    ),
  }));

  return touch(
    addHistory(next, {
      at: new Date().toISOString(),
      topic,
      kind: "quiz",
      detail: `Scored ${report.scorePercent}% (${report.correctCount}/${report.totalCount})`,
    }),
  );
}

export function recordMastery(
  profile: LearnerProfileRecord,
  topic: string,
  conceptLabel: string,
): LearnerProfileRecord {
  const next = upsertTopic(profile, topic, (record) => ({
    ...record,
    conceptsCompleted: unique([...record.conceptsCompleted, conceptLabel]),
    conceptsWeak: record.conceptsWeak.filter((label) => label !== conceptLabel),
  }));

  return touch(
    addHistory(next, {
      at: new Date().toISOString(),
      topic,
      kind: "mastery",
      detail: `Mastered "${conceptLabel}"`,
    }),
  );
}

// ---------------------------------------------------------------------------
// Reading the profile back
// ---------------------------------------------------------------------------

export function averageScore(record: TopicRecord): number | null {
  if (record.scores.length === 0) return null;
  return Math.round(record.scores.reduce((a, b) => a + b, 0) / record.scores.length);
}

/**
 * A short briefing on this student, written into the teaching prompt so a
 * returning learner is met with continuity — "last time you found this hard"
 * — instead of a blank slate. Deliberately compact: it is prepended to every
 * turn, and a profile summary that grows without bound would slowly crowd out
 * the retrieved passages that matter more.
 */
export function buildProfileBriefing(
  profile: LearnerProfileRecord,
  currentTopic?: string,
): string {
  if (profile.topics.length === 0) return "";

  const lines: string[] = [];
  const related = currentTopic
    ? profile.topics.find((record) =>
        record.topic.toLowerCase().includes(currentTopic.toLowerCase().slice(0, 16)),
      )
    : undefined;

  if (related) {
    const average = averageScore(related);
    lines.push(`This student has studied "${related.topic}" before (${related.sessions} session${related.sessions === 1 ? "" : "s"}).`);
    if (related.conceptsWeak.length > 0) {
      lines.push(`They have previously struggled with: ${related.conceptsWeak.slice(0, 5).join(", ")}. Check these before assuming them, and slow down when you reach one.`);
    }
    if (related.conceptsCompleted.length > 0) {
      lines.push(`They have already mastered: ${related.conceptsCompleted.slice(0, 6).join(", ")}. Do not re-teach these from scratch.`);
    }
    if (average !== null) {
      lines.push(`Their average quiz score on this topic is ${average}%.`);
    }
  } else {
    const recent = profile.topics.slice(0, 3).map((record) => record.topic);
    lines.push(`This student has studied: ${recent.join(", ")}. Draw analogies from those subjects where they genuinely help.`);
  }

  return `RETURNING STUDENT — what you already know about this learner from earlier sessions:\n${lines.join("\n")}`;
}
