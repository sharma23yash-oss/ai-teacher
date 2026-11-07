import board from "@/data/exams/board.json";
import cfaL1 from "@/data/exams/cfa-l1.json";
import gateCs from "@/data/exams/gate-cs.json";
import nismXv from "@/data/exams/nism-xv.json";
import { EXAM_PRESET_META, type ExamPreset } from "@/lib/types";
import type { Syllabus } from "./schema";

/**
 * Syllabus maps for the exam presets, from data/exams/*.json. The files are
 * validated by lib/exams/__tests__/exam-content.test.ts, so this module only
 * casts them (it is imported by client code, and zod stays out of that bundle).
 */
const SYLLABI: Record<string, Syllabus> = {
  "nism-xv": nismXv as unknown as Syllabus,
  "cfa-l1": cfaL1 as unknown as Syllabus,
  "gate-cs": gateCs as unknown as Syllabus,
  board: board as unknown as Syllabus,
};

export type SyllabusChapter = Syllabus["chapters"][number];

export function syllabusFor(preset: ExamPreset): Syllabus | null {
  return SYLLABI[EXAM_PRESET_META[preset].syllabusId] ?? null;
}

/** "18%", "15–20%", or null when the weightage isn't filled in yet. */
export function weightageLabel(chapter: SyllabusChapter): string | null {
  if (chapter.weightagePercent !== null) return `${chapter.weightagePercent}%`;
  if (chapter.weightageRange) return `${chapter.weightageRange[0]}–${chapter.weightageRange[1]}%`;
  return null;
}

/** A single planning weight per chapter: exact %, else the middle of the range, else null. */
export function chapterWeight(chapter: SyllabusChapter): number | null {
  if (chapter.weightagePercent !== null) return chapter.weightagePercent;
  if (chapter.weightageRange) return (chapter.weightageRange[0] + chapter.weightageRange[1]) / 2;
  return null;
}

/** True when no chapter has a weightage yet (placeholder files). */
export function hasWeightage(syllabus: Syllabus): boolean {
  return syllabus.chapters.some((chapter) => chapterWeight(chapter) !== null);
}

/** Prompt block describing the syllabus, honest about what is unverified. */
export function syllabusBriefing(syllabus: Syllabus): string {
  const verified = syllabus.status === "verified";
  const caveat = verified
    ? `Verified against ${syllabus.source.document ?? "the official syllabus"}.`
    : "This map is an UNVERIFIED draft: use it to organise lessons, but never tell the student these chapter names, weightages or exam numbers are official.";

  const f = syllabus.format;
  const formatBits = [
    f.questions !== null ? `${f.questions} questions` : null,
    f.durationMinutes !== null ? `${f.durationMinutes} minutes` : null,
    f.totalMarks !== null ? `${f.totalMarks} marks` : null,
    f.passPercent !== null ? `pass mark ${f.passPercent}%` : null,
    f.negativeMarking ? `negative marking: ${f.negativeMarking}` : null,
  ].filter(Boolean);

  const chapters = syllabus.chapters
    .map((chapter) => {
      const weight = weightageLabel(chapter);
      return `- ${chapter.title}${weight ? ` (weightage ${weight})` : ""}`;
    })
    .join("\n");

  return `Syllabus map for ${syllabus.name}. ${caveat}${
    formatBits.length > 0 ? `\nExam format: ${formatBits.join(", ")}.` : ""
  }\nChapters:\n${chapters}${
    hasWeightage(syllabus)
      ? "\nSpend proportionally more time and practice on higher-weightage chapters, and say so when you choose what to cover next."
      : ""
  }`;
}

/**
 * Picks a chapter to practise, with probability proportional to its weight.
 * Chapters without a weight share equally when nothing is filled in; once
 * some weights exist, unweighted chapters get the average weight.
 */
export function pickChapterByWeight<T extends SyllabusChapter>(chapters: T[], random: () => number = Math.random): T | null {
  if (chapters.length === 0) return null;
  const known = chapters.map(chapterWeight).filter((w): w is number => w !== null && w > 0);
  const fallback = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  const weights = chapters.map((chapter) => {
    const w = chapterWeight(chapter);
    return w !== null && w > 0 ? w : fallback;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (let i = 0; i < chapters.length; i++) {
    r -= weights[i];
    if (r < 0) return chapters[i];
  }
  return chapters[chapters.length - 1];
}
