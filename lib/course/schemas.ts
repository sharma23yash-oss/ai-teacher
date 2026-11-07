import { z } from "zod";
import { EXAM_PRESETS, LANGUAGES, TEACHER_MODEL_IDS } from "@/lib/types";

/**
 * Request and model-output shapes for /api/course: chapter summaries, the
 * question generator and descriptive-answer grading.
 *
 * Citations: the model only ever refers to passages by the number it was
 * shown ("source": 3). The server turns that into the passage's real page or
 * slide, so a page number the model invents can never reach the student.
 */

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

// ---- Model outputs ---------------------------------------------------------

export const summaryOutputSchema = z.object({
  overview: z.string().min(1).max(1500),
  keyPoints: z
    .array(z.object({ point: z.string().min(1).max(400), source: z.number().int().optional() }))
    .min(1)
    .max(10),
  /** What the student might expect here that the passages do not cover. */
  notCovered: z.string().max(400).optional(),
});

const markingPointSchema = z.object({ point: z.string().min(1).max(400), marks: z.number().positive().max(20) });

export const generatedQuestionSchema = z.object({
  type: z.enum(["mcq", "descriptive"]),
  difficulty: z.enum(DIFFICULTIES),
  concept: z.string().min(1).max(120),
  question: z.string().min(1).max(1500),
  options: z.array(z.string().min(1).max(400)).optional(),
  answerIndex: z.number().int().optional(),
  explanation: z.string().min(1).max(1500),
  marks: z.number().positive().max(20),
  modelAnswer: z.string().max(3000).optional(),
  markingScheme: z.array(markingPointSchema).max(10).optional(),
  source: z.number().int().optional(),
});

export const questionsOutputSchema = z.object({
  questions: z.array(generatedQuestionSchema).min(1).max(12),
});

export const gradeOutputSchema = z.object({
  points: z
    .array(z.object({ point: z.string().min(1).max(400), awarded: z.number(), comment: z.string().max(400) }))
    .min(1)
    .max(10),
  feedback: z.string().min(1).max(1000),
  improve: z.string().max(1000),
});

export type SummaryOutput = z.infer<typeof summaryOutputSchema>;
export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;
export type GradeOutput = z.infer<typeof gradeOutputSchema>;

// ---- What the API returns ----------------------------------------------------

export interface Citation {
  /** "p. 12", "slide 4"; absent for documents without pages. */
  locator?: string;
  heading?: string;
}

export interface CourseSummary {
  chapterTitle: string;
  overview: string;
  keyPoints: { point: string; citation?: Citation }[];
  notCovered?: string;
}

export interface PracticeQuestion {
  id: string;
  type: "mcq" | "descriptive";
  difficulty: Difficulty;
  concept: string;
  question: string;
  options?: string[];
  answerIndex?: number;
  explanation: string;
  marks: number;
  modelAnswer?: string;
  markingScheme?: { point: string; marks: number }[];
  citation?: Citation;
}

export interface GradeResult {
  points: { point: string; awarded: number; max: number; comment: string }[];
  total: number;
  max: number;
  feedback: string;
  improve: string;
}

export type CourseResponseBody =
  | { ok: true; summary: CourseSummary }
  | { ok: true; questions: PracticeQuestion[] }
  | { ok: true; grade: GradeResult }
  | { ok: false; error: string };

// ---- Requests ----------------------------------------------------------------

const common = {
  language: z.enum(LANGUAGES),
  modelId: z.enum(TEACHER_MODEL_IDS),
};

const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("document"), docId: z.uuid(), chapterId: z.string().regex(/^ch\d{1,3}$/) }),
  z.object({ kind: z.literal("topic"), topic: z.string().trim().min(2).max(200) }),
  z.object({ kind: z.literal("exam"), exam: z.enum(EXAM_PRESETS), chapterId: z.string().regex(/^[a-z0-9-]+$/) }),
]);

export const courseRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("summary"),
    docId: z.uuid(),
    chapterId: z.string().regex(/^ch\d{1,3}$/),
    ...common,
  }),
  z.object({
    action: z.literal("questions"),
    source: sourceSchema,
    count: z.number().int().min(1).max(10),
    difficulty: z.enum([...DIFFICULTIES, "mixed"]),
    types: z.enum(["mcq", "descriptive", "mixed"]),
    examPreset: z.enum(EXAM_PRESETS).optional(),
    ...common,
  }),
  z.object({
    action: z.literal("grade"),
    question: z.string().trim().min(1).max(1500),
    modelAnswer: z.string().max(3000).optional(),
    markingScheme: z.array(markingPointSchema).min(1).max(10),
    marks: z.number().positive().max(20),
    studentAnswer: z.string().trim().min(1).max(4000),
    examPreset: z.enum(EXAM_PRESETS).optional(),
    ...common,
  }),
]);

export type CourseRequest = z.infer<typeof courseRequestSchema>;
export type QuestionSource = z.infer<typeof sourceSchema>;
