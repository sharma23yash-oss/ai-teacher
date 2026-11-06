import { z } from "zod";

/**
 * Shape of the exam content files in data/exams/. These are the syllabus maps
 * (chapters and weightage) and question banks that Phase 3 exam mode will use.
 *
 * `status` tells you how far to trust a file:
 *   placeholder: structure only; values are null or obviously fake.
 *   draft: filled in from memory or secondary sources; must be checked.
 *   verified: checked against the official document named in `source`.
 */
export const CONTENT_STATUS = ["placeholder", "draft", "verified"] as const;

const idPattern = /^[a-z0-9-]+$/;

export const chapterSchema = z
  .object({
    id: z.string().regex(idPattern),
    title: z.string().min(1),
    /** Exact share of marks, when the exam body publishes one. */
    weightagePercent: z.number().min(0).max(100).nullable(),
    /** Published range instead of an exact figure (CFA does this). */
    weightageRange: z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]).nullable().optional(),
    topics: z.array(z.string().min(1)),
    /** What still needs checking for this chapter. Remove once verified. */
    todo: z.string().optional(),
  })
  .refine((c) => !c.weightageRange || c.weightageRange[0] <= c.weightageRange[1], {
    message: "weightageRange must be [min, max]",
  });

export const syllabusSchema = z
  .object({
    exam: z.string().regex(idPattern),
    name: z.string().min(1),
    conductedBy: z.string().min(1),
    status: z.enum(CONTENT_STATUS),
    source: z.object({
      document: z.string().nullable(),
      version: z.string().nullable(),
      url: z.url().nullable(),
      verifiedOn: z.iso.date().nullable(),
    }),
    format: z.object({
      questions: z.number().int().positive().nullable(),
      durationMinutes: z.number().int().positive().nullable(),
      totalMarks: z.number().positive().nullable(),
      passPercent: z.number().min(0).max(100).nullable(),
      negativeMarking: z.string().nullable(),
    }),
    chapters: z.array(chapterSchema).min(1),
    todo: z.array(z.string()).optional(),
  })
  .refine(
    (s) => {
      const weights = s.chapters.map((c) => c.weightagePercent);
      if (weights.some((w) => w === null)) return true; // not filled in yet
      const total = (weights as number[]).reduce((a, b) => a + b, 0);
      return Math.abs(total - 100) < 0.5;
    },
    { message: "Once every chapter has weightagePercent, they must add up to 100" },
  )
  .refine((s) => new Set(s.chapters.map((c) => c.id)).size === s.chapters.length, {
    message: "Chapter ids must be unique",
  })
  .refine((s) => s.status !== "verified" || (s.source.document !== null && s.source.verifiedOn !== null), {
    message: "A verified file must name its source document and the date it was checked",
  });

export const questionSchema = z
  .object({
    id: z.string().regex(idPattern),
    chapterId: z.string().regex(idPattern),
    concept: z.string().min(1),
    difficulty: z.enum(["easy", "medium", "hard"]),
    type: z.literal("mcq"),
    stem: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).max(6),
    answerIndex: z.number().int().min(0),
    explanation: z.string().min(1),
    marks: z.number().positive(),
    negativeMarks: z.number().min(0),
    source: z.object({ document: z.string().nullable(), page: z.number().int().positive().nullable() }),
    status: z.enum(CONTENT_STATUS),
    /** Optional link to an entry in data/misconceptions/*.json that a wrong option targets. */
    misconceptionId: z.string().regex(idPattern).optional(),
  })
  .refine((q) => q.answerIndex < q.options.length, { message: "answerIndex points past the options" });

export const questionBankSchema = z
  .object({
    exam: z.string().regex(idPattern),
    status: z.enum(CONTENT_STATUS),
    questions: z.array(questionSchema),
  })
  .refine((b) => new Set(b.questions.map((q) => q.id)).size === b.questions.length, {
    message: "Question ids must be unique",
  });

export type Syllabus = z.infer<typeof syllabusSchema>;
export type Question = z.infer<typeof questionSchema>;
export type QuestionBank = z.infer<typeof questionBankSchema>;
