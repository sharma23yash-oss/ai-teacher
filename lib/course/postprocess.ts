import type { KnowledgeChunk } from "@/lib/types";
import type {
  Citation,
  CourseSummary,
  GeneratedQuestion,
  GradeOutput,
  GradeResult,
  PracticeQuestion,
  SummaryOutput,
} from "./schemas";

/**
 * Pure clean-up of model output for /api/course. Models get the arithmetic
 * and the bookkeeping wrong often enough that the server never trusts them
 * with it: citations, MCQ answer indexes, mark totals and clamping are all
 * fixed or checked here.
 */

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Passage number as shown to the model (1-based) to the passage's real location. */
export function citationFor(source: number | undefined, passages: KnowledgeChunk[]): Citation | undefined {
  if (source === undefined || !Number.isInteger(source)) return undefined;
  const chunk = passages[source - 1];
  if (!chunk) return undefined;
  const citation: Citation = {};
  if (chunk.locator) citation.locator = chunk.locator;
  if (chunk.heading) citation.heading = chunk.heading;
  return citation.locator || citation.heading ? citation : undefined;
}

export function finaliseSummary(output: SummaryOutput, passages: KnowledgeChunk[], chapterTitle: string): CourseSummary {
  return {
    chapterTitle,
    overview: output.overview.trim(),
    keyPoints: output.keyPoints.map(({ point, source }) => ({ point: point.trim(), citation: citationFor(source, passages) })),
    notCovered: output.notCovered?.trim() || undefined,
  };
}

/**
 * Makes generated questions safe to show:
 *   - MCQs need 2-6 distinct options and an answerIndex that points at one.
 *   - Descriptive questions need a marking scheme; its marks are rescaled to
 *     add up to the question's marks.
 *   - Citations are resolved from passage numbers.
 */
export function normaliseQuestions(
  questions: GeneratedQuestion[],
  passages: KnowledgeChunk[],
  idPrefix: string,
): PracticeQuestion[] {
  const out: PracticeQuestion[] = [];
  for (const q of questions) {
    const base = {
      id: `${idPrefix}-${out.length + 1}`,
      difficulty: q.difficulty,
      concept: q.concept.trim(),
      question: q.question.trim(),
      explanation: q.explanation.trim(),
      citation: citationFor(q.source, passages),
    };

    if (q.type === "mcq") {
      const options = (q.options ?? []).map((o) => o.trim()).filter(Boolean);
      const distinct = new Set(options.map((o) => o.toLowerCase())).size === options.length;
      if (options.length < 2 || options.length > 6 || !distinct) continue;
      if (q.answerIndex === undefined || q.answerIndex < 0 || q.answerIndex >= options.length) continue;
      out.push({ ...base, type: "mcq", options, answerIndex: q.answerIndex, marks: round1(q.marks) });
      continue;
    }

    const scheme = (q.markingScheme ?? []).filter((p) => p.point.trim() && p.marks > 0);
    if (scheme.length === 0) continue;
    const marks = round1(q.marks);
    const sum = scheme.reduce((total, p) => total + p.marks, 0);
    const scale = Math.abs(sum - marks) < 0.05 ? 1 : marks / sum;
    const scaled = scheme.map((p) => ({ point: p.point.trim(), marks: round1(p.marks * scale) }));
    // Rounding can leave the total a tenth off; put the difference on the last point.
    const drift = round1(marks - scaled.reduce((t, p) => t + p.marks, 0));
    if (drift !== 0) scaled[scaled.length - 1].marks = round1(scaled[scaled.length - 1].marks + drift);
    out.push({
      ...base,
      type: "descriptive",
      marks,
      markingScheme: scaled,
      modelAnswer: q.modelAnswer?.trim() || undefined,
    });
  }
  return out;
}

/**
 * Lines the model's per-point marks up with the real marking scheme (by
 * position), clamps each to [0, max], and computes the total itself.
 */
export function finaliseGrade(output: GradeOutput, scheme: { point: string; marks: number }[]): GradeResult {
  const points = scheme.map((item, i) => {
    const graded = output.points[i];
    const awarded = graded && Number.isFinite(graded.awarded) ? Math.min(item.marks, Math.max(0, graded.awarded)) : 0;
    // Half-mark steps, as examiners award them.
    const stepped = Math.round(awarded * 2) / 2;
    return {
      point: item.point,
      awarded: Math.min(item.marks, stepped),
      max: item.marks,
      comment: graded?.comment?.trim() || (graded ? "" : "Not addressed."),
    };
  });
  return {
    points,
    total: round1(points.reduce((t, p) => t + p.awarded, 0)),
    max: round1(scheme.reduce((t, p) => t + p.marks, 0)),
    feedback: output.feedback.trim(),
    improve: output.improve.trim(),
  };
}

/** Passages numbered for a prompt, wrapped as untrusted content. */
export function numberedPassages(passages: KnowledgeChunk[]): string {
  const body = passages
    .map((chunk, i) => {
      const label = [chunk.locator, chunk.heading].filter(Boolean).join(" · ");
      return `[${i + 1}${label ? ` · ${label}` : ""}]\n${chunk.text}`;
    })
    .join("\n\n");
  return `<untrusted_context>\n${body}\n</untrusted_context>`;
}
