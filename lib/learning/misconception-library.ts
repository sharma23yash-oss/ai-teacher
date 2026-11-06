import "server-only";
import biology from "@/data/misconceptions/biology.json";
import computerScience from "@/data/misconceptions/computer-science.json";
import finance from "@/data/misconceptions/finance.json";
import mathematics from "@/data/misconceptions/mathematics.json";
import physics from "@/data/misconceptions/physics.json";
import {
  buildDiagnosticsBlock,
  matchMisconceptions,
  misconceptionLibrarySchema,
  type MisconceptionLibrary,
} from "./misconceptions";

/**
 * All subject files, validated once at module load. To add a subject, create
 * data/misconceptions/<subject>.json and import it here. A malformed file is
 * skipped with a warning rather than taking the teach route down.
 */
const LIBRARIES: MisconceptionLibrary[] = [physics, finance, computerScience, biology, mathematics].flatMap(
  (raw) => {
    const parsed = misconceptionLibrarySchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("Skipping invalid misconception file:", parsed.error.issues[0]?.message);
      return [];
    }
    return [parsed.data];
  },
);

/** Diagnostics prompt block for this turn, or "" when nothing in the library matches. */
export function diagnosticsFor(text: string, limit = 3): string {
  return buildDiagnosticsBlock(matchMisconceptions(LIBRARIES, text, limit));
}
