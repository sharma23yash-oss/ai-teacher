import { z } from "zod";

/**
 * The misconception library: known wrong beliefs per subject, each with a
 * diagnostic question that exposes it and a fix. The teach route matches
 * entries against the current concept and the student's message and adds the
 * best matches to the prompt, so the teacher checks for them on purpose
 * instead of hoping they come up.
 *
 * Data lives in data/misconceptions/<subject>.json (one file per subject).
 */

export const misconceptionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  concept: z.string().min(1),
  /** Lower-case words or phrases that signal this concept is being taught. */
  keywords: z.array(z.string().min(2)).min(1),
  wrongBelief: z.string().min(1),
  whyWrong: z.string().min(1),
  diagnosticQuestion: z.string().min(1),
  fix: z.string().min(1),
});

export const misconceptionLibrarySchema = z.object({
  subject: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  entries: z.array(misconceptionSchema).min(1),
});

export type Misconception = z.infer<typeof misconceptionSchema>;
export type MisconceptionLibrary = z.infer<typeof misconceptionLibrarySchema>;

export interface MisconceptionMatch extends Misconception {
  subject: string;
  score: number;
}

/** Lower-case, accent-free, words separated by single spaces, padded so phrase matching respects word boundaries. */
function normalise(text: string): string {
  const words = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return ` ${words} `;
}

/**
 * Entries whose keywords appear in `text`, best first. A multi-word keyword
 * counts for more than a single word because it is more specific.
 */
export function matchMisconceptions(
  libraries: MisconceptionLibrary[],
  text: string,
  limit = 3,
): MisconceptionMatch[] {
  const haystack = normalise(text);
  if (haystack.trim() === "") return [];
  const matches: MisconceptionMatch[] = [];
  for (const library of libraries) {
    for (const entry of library.entries) {
      let score = 0;
      for (const keyword of entry.keywords) {
        const needle = normalise(keyword);
        if (needle.trim() && haystack.includes(needle)) {
          score += needle.trim().split(" ").length;
        }
      }
      if (score > 0) matches.push({ ...entry, subject: library.subject, score });
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Prompt block that asks the teacher to probe for the matched misconceptions. */
export function buildDiagnosticsBlock(matches: MisconceptionMatch[]): string {
  if (matches.length === 0) return "";
  const items = matches
    .map(
      (m, i) =>
        `${i + 1}. ${m.concept}: students often believe "${m.wrongBelief}"\n   Why it's wrong: ${m.whyWrong}\n   Diagnostic question: ${m.diagnosticQuestion}\n   How to fix it: ${m.fix}`,
    )
    .join("\n");
  return `Known Misconceptions (from the misconception library). When you reach the matching concept, use the diagnostic question (in your own words and the student's language) to check whether the student holds the wrong belief before marking the concept completed. If their answer shows it, set that concept to "misconception", name the wrong idea kindly, and use the fix. Do not mention this list to the student.\n${items}`;
}
