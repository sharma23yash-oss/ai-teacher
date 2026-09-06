import { z } from "zod";
import {
  AI_PROVIDERS,
  GESTURE_SIGNALS,
  LANGUAGES,
  LEARNER_LEVELS,
  TEACHER_MODEL_IDS,
  TEACHER_PERSONAS,
  TEACH_MODES,
  TIME_BUDGETS,
  VOICE_GENDERS,
} from "./types";

/**
 * Zod schemas for every JSON request body this app accepts.
 *
 * These sit in front of the API routes as a strict shape-and-bounds check —
 * wrong types, missing fields, and absurdly long strings are rejected here,
 * before any of that data reaches a provider prompt, the RAG pipeline, or
 * disk. This is deliberately independent of the runtime types in
 * lib/types.ts (rather than derived with z.infer and used as the source of
 * truth) so a change to one is never silently trusted to also constrain the
 * other — the schemas below are the enforcement layer, the types are the
 * compile-time contract, and both are expected to agree by hand.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

// Generous but finite — this is an abuse/malformed-payload guard, not a UX
// limit, so it sits well above anything a real student would ever type.
const MESSAGE_MAX_CHARS = 8000;
const UPLOADED_CONTENT_MAX_CHARS = 200_000;
const BRIEFING_MAX_CHARS = 4000;
const WEBCAM_FRAME_MAX_CHARS = 5_000_000;

const nonEmptyTrimmed = (max: number) => z.string().trim().min(1).max(max);

const conceptNodeSchema = z.object({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(300),
  status: z.enum(["completed", "current", "misconception", "locked"]),
});

const studentProfileSchema = z.object({
  understood_concepts: z.array(z.string().max(300)).max(200),
  identified_misconceptions: z.array(z.string().max(300)).max(200),
});

const lessonStateSchema = z.object({
  teaching_phase: z.enum(["introduction", "explanation", "assessment", "scaffolding"]),
  concept_plan: z.array(conceptNodeSchema).max(50),
  student_profile: studentProfileSchema,
});

const chatMessageSchema = z.object({
  id: z.string().min(1).max(200),
  role: z.enum(["student", "teacher"]),
  content: z.string().max(MESSAGE_MAX_CHARS),
});

// ---------------------------------------------------------------------------
// /api/teach
// ---------------------------------------------------------------------------

export const teachRequestSchema = z.object({
  history: z.array(chatMessageSchema).max(500),
  message: nonEmptyTrimmed(MESSAGE_MAX_CHARS),
  uploadedContent: z.string().max(UPLOADED_CONTENT_MAX_CHARS).optional(),
  modelId: z.enum(TEACHER_MODEL_IDS),
  extendedThinking: z.boolean(),
  persona: z.enum(TEACHER_PERSONAS),
  language: z.enum(LANGUAGES),
  timeBudget: z.enum(TIME_BUDGETS),
  learnerLevel: z.enum(LEARNER_LEVELS).optional(),
  docId: z.uuid().optional(),
  profileBriefing: z.string().max(BRIEFING_MAX_CHARS).optional(),
  action: z.enum(["teach", "take_quiz"]).optional(),
  mode: z.enum(TEACH_MODES).optional(),
  conceptPlan: z.array(conceptNodeSchema).max(50).optional(),
  webcamFrame: nonEmptyTrimmed(WEBCAM_FRAME_MAX_CHARS).optional(),
  gestureSignal: z.enum(GESTURE_SIGNALS).optional(),
  lessonState: lessonStateSchema.optional(),
});

export type TeachRequestInput = z.infer<typeof teachRequestSchema>;

// ---------------------------------------------------------------------------
// /api/tts
// ---------------------------------------------------------------------------

// Mirrors MAX_TEXT_CHARS in app/api/tts/route.ts — validated again here so a
// malformed/oversized payload is rejected before that route's own logic runs.
const TTS_TEXT_MAX_CHARS = 2000;

export const ttsRequestSchema = z.object({
  text: nonEmptyTrimmed(TTS_TEXT_MAX_CHARS),
  persona: z.enum(TEACHER_PERSONAS),
  language: z.enum(LANGUAGES),
  voiceGender: z.enum(VOICE_GENDERS),
});

export type TtsRequestInput = z.infer<typeof ttsRequestSchema>;

// ---------------------------------------------------------------------------
// /api/refine
// ---------------------------------------------------------------------------

// Mirrors MAX_RAW_PROMPT_CHARS in app/api/refine/route.ts.
const RAW_PROMPT_MAX_CHARS = 2000;

export const refineRequestSchema = z.object({
  rawPrompt: nonEmptyTrimmed(RAW_PROMPT_MAX_CHARS),
});

export type RefineRequestInput = z.infer<typeof refineRequestSchema>;

// ---------------------------------------------------------------------------
// /api/upload — only the form-field-adjacent metadata Zod can usefully check.
// The substantive validation (size, magic-byte content sniffing) happens in
// the route itself, against the actual File object, which Zod has no native
// representation for.
// ---------------------------------------------------------------------------

export const uploadFileNameSchema = z.string().trim().min(1).max(255);

// ---------------------------------------------------------------------------
// Providers config route has no request body — nothing to validate.
// ---------------------------------------------------------------------------

export const providerNameSchema = z.enum(AI_PROVIDERS);

/**
 * Formats a ZodError into one short, safe sentence — specific enough to fix
 * a genuine client bug, generic enough to never echo attacker-supplied
 * content back into the response.
 */
export function formatZodError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return "Invalid request body.";
  const path = first.path.length > 0 ? first.path.join(".") : "(root)";
  return `Invalid request body at "${path}": ${first.message}`;
}
