import "server-only";
import { Redis } from "@upstash/redis";
import type { MetricsEvent } from "./events";

/**
 * Aggregate-only metrics storage.
 *
 * Events are folded into counters the moment they arrive; nothing per-person
 * is kept. Uses Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN are set (the
 * same database the rate limiter uses). Without them it falls back to memory,
 * which resets on every cold start and is not shared between serverless
 * instances, so the /metrics page warns when that is the case.
 */

const PREFIX = "metrics";
const DAILY_TTL_SECONDS = 400 * 24 * 60 * 60;
const MAX_FEEDBACK_ENTRIES = 200;

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

export const isPersistent = redis !== null;

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

export const QUIZ_BUCKETS = ["0-49", "50-69", "70-89", "90-100"] as const;
export const SESSION_BUCKETS = ["<2 min", "2-10 min", "10-30 min", "30+ min"] as const;

function quizBucket(score: number): string {
  if (score < 50) return QUIZ_BUCKETS[0];
  if (score < 70) return QUIZ_BUCKETS[1];
  if (score < 90) return QUIZ_BUCKETS[2];
  return QUIZ_BUCKETS[3];
}

function sessionBucket(seconds: number): string {
  if (seconds < 120) return SESSION_BUCKETS[0];
  if (seconds < 600) return SESSION_BUCKETS[1];
  if (seconds < 1800) return SESSION_BUCKETS[2];
  return SESSION_BUCKETS[3];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Write path: one event -> a list of hash increments (+ maybe a feedback entry)
// ---------------------------------------------------------------------------

type Increment = [hash: string, field: string, by: number];

function incrementsFor(event: MetricsEvent): Increment[] {
  const daily = `daily:${today()}`;
  switch (event.type) {
    case "lesson_started":
      return [
        ["counters", "lessons_started", 1],
        ["languages", event.language, 1],
        ["levels", event.level, 1],
        ["durations", event.timeBudget, 1],
        ["personas", event.persona, 1],
        ["tiers", event.tier, 1],
        ["exams", event.examPreset ?? "none", 1],
        ["counters", "lessons_with_document", event.hasDocument ? 1 : 0],
        [daily, "started", 1],
      ];
    case "lesson_completed":
      return [
        ["counters", "lessons_completed", 1],
        ["counters", "lesson_seconds_sum", event.durationSec],
        ["completed_via", event.via, 1],
        [daily, "completed", 1],
      ];
    case "quiz_completed":
      return [
        ["counters", "quizzes", 1],
        ["counters", "quiz_score_sum", event.scorePercent],
        ["quiz_buckets", quizBucket(event.scorePercent), 1],
        [daily, "quizzes", 1],
      ];
    case "feedback":
      return [
        ["feedback", event.rating, 1],
        [daily, "feedback", 1],
      ];
    case "session_end":
      return [
        ["counters", "sessions", 1],
        ["counters", "session_seconds_sum", event.durationSec],
        ["session_buckets", sessionBucket(event.durationSec), 1],
        [daily, "sessions", 1],
      ];
  }
}

interface FeedbackEntry {
  rating: string;
  comment: string;
  date: string;
}

interface Memory {
  hashes: Map<string, Map<string, number>>;
  feedback: FeedbackEntry[];
}

// In-memory fallback, kept on globalThis so dev-server hot reloads don't wipe it.
const globalStore = globalThis as { __aiTeacherMetrics?: Memory };
const memory: Memory = (globalStore.__aiTeacherMetrics ??= { hashes: new Map(), feedback: [] });

export async function recordEvent(event: MetricsEvent): Promise<void> {
  const increments = incrementsFor(event).filter(([, , by]) => by !== 0);
  const comment = event.type === "feedback" ? event.comment?.trim() : undefined;
  const entry: FeedbackEntry | null = comment
    ? { rating: event.type === "feedback" ? event.rating : "", comment, date: today() }
    : null;

  if (redis) {
    const pipeline = redis.pipeline();
    for (const [hash, field, by] of increments) {
      pipeline.hincrby(`${PREFIX}:${hash}`, field, by);
      if (hash.startsWith("daily:")) pipeline.expire(`${PREFIX}:${hash}`, DAILY_TTL_SECONDS);
    }
    if (entry) {
      pipeline.lpush(`${PREFIX}:feedback_comments`, JSON.stringify(entry));
      pipeline.ltrim(`${PREFIX}:feedback_comments`, 0, MAX_FEEDBACK_ENTRIES - 1);
    }
    await pipeline.exec();
    return;
  }

  for (const [hash, field, by] of increments) {
    const map = memory.hashes.get(hash) ?? new Map<string, number>();
    map.set(field, (map.get(field) ?? 0) + by);
    memory.hashes.set(hash, map);
  }
  if (entry) {
    memory.feedback.unshift(entry);
    memory.feedback.length = Math.min(memory.feedback.length, MAX_FEEDBACK_ENTRIES);
  }
}

// ---------------------------------------------------------------------------
// Read path (for the /metrics page)
// ---------------------------------------------------------------------------

const SUMMARY_HASHES = [
  "counters",
  "languages",
  "levels",
  "durations",
  "personas",
  "tiers",
  "exams",
  "completed_via",
  "quiz_buckets",
  "session_buckets",
  "feedback",
] as const;

export type HashName = (typeof SUMMARY_HASHES)[number];

export interface MetricsSnapshot {
  hashes: Record<HashName, Record<string, number>>;
  daily: { date: string; values: Record<string, number> }[];
  comments: FeedbackEntry[];
}

function toNumbers(record: Record<string, unknown> | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(record ?? {})) out[key] = Number(value) || 0;
  return out;
}

function lastNDates(days: number): string[] {
  const dates: string[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    dates.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10));
  }
  return dates;
}

export async function readSnapshot(days = 14): Promise<MetricsSnapshot> {
  const dates = lastNDates(days);

  if (redis) {
    const pipeline = redis.pipeline();
    for (const name of SUMMARY_HASHES) pipeline.hgetall(`${PREFIX}:${name}`);
    for (const date of dates) pipeline.hgetall(`${PREFIX}:daily:${date}`);
    pipeline.lrange(`${PREFIX}:feedback_comments`, 0, 49);
    const results = (await pipeline.exec()) as unknown[];

    const hashes = {} as MetricsSnapshot["hashes"];
    SUMMARY_HASHES.forEach((name, i) => {
      hashes[name] = toNumbers(results[i] as Record<string, unknown> | null);
    });
    const daily = dates.map((date, i) => ({
      date,
      values: toNumbers(results[SUMMARY_HASHES.length + i] as Record<string, unknown> | null),
    }));
    const rawComments = (results[results.length - 1] as unknown[]) ?? [];
    // Upstash auto-parses JSON strings, so entries may already be objects.
    const comments = rawComments
      .map((raw) => {
        if (typeof raw === "string") {
          try {
            return JSON.parse(raw) as FeedbackEntry;
          } catch {
            return null;
          }
        }
        return raw as FeedbackEntry;
      })
      .filter((entry): entry is FeedbackEntry => entry !== null);
    return { hashes, daily, comments };
  }

  const hashes = {} as MetricsSnapshot["hashes"];
  for (const name of SUMMARY_HASHES) {
    hashes[name] = Object.fromEntries(memory.hashes.get(name) ?? []);
  }
  const daily = dates.map((date) => ({
    date,
    values: Object.fromEntries(memory.hashes.get(`daily:${date}`) ?? []),
  }));
  return { hashes, daily, comments: memory.feedback.slice(0, 50) };
}
