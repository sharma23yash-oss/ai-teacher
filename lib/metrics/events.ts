import { z } from "zod";
import {
  EXAM_PRESETS,
  LANGUAGES,
  LEARNER_LEVELS,
  MODEL_TIERS,
  TEACHER_PERSONAS,
  TIME_BUDGETS,
} from "@/lib/types";

/**
 * The only events the app records. Every field is a category or a number:
 * no user id, no IP, no cookie, and no lesson content. The one free-text
 * field is the optional comment a student chooses to type into the feedback
 * card, and it is capped.
 *
 * Shared by the browser (to build events) and the API route (to validate them).
 */

const MAX_DURATION_SECONDS = 6 * 60 * 60;
export const FEEDBACK_COMMENT_MAX_CHARS = 500;

const duration = z.number().int().min(0).max(MAX_DURATION_SECONDS);

export const FEEDBACK_RATINGS = ["yes", "partly", "no"] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

export const metricsEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("lesson_started"),
    language: z.enum(LANGUAGES),
    level: z.enum(LEARNER_LEVELS),
    timeBudget: z.enum(TIME_BUDGETS),
    persona: z.enum(TEACHER_PERSONAS),
    tier: z.enum(MODEL_TIERS),
    examPreset: z.enum(EXAM_PRESETS).nullable(),
    hasDocument: z.boolean(),
  }),
  z.object({
    type: z.literal("lesson_completed"),
    durationSec: duration,
    via: z.enum(["concepts", "quiz"]),
  }),
  z.object({
    type: z.literal("quiz_completed"),
    scorePercent: z.number().int().min(0).max(100),
  }),
  z.object({
    type: z.literal("feedback"),
    rating: z.enum(FEEDBACK_RATINGS),
    comment: z.string().trim().max(FEEDBACK_COMMENT_MAX_CHARS).optional(),
  }),
  z.object({
    type: z.literal("session_end"),
    durationSec: duration,
    lessons: z.number().int().min(0).max(100),
  }),
]);

export type MetricsEvent = z.infer<typeof metricsEventSchema>;
