/**
 * Plain-text structure detection, shared by PDF and .txt/.md extraction.
 * Kept free of server-only imports so it can be unit tested.
 */

export interface ExtractedBlock {
  /** Nearest enclosing heading, chapter, or slide title. */
  heading?: string;
  text: string;
  /** 1-based page (PDF) or slide (PPTX) the block came from. */
  page?: number;
}

/** What a document's page numbers count: printed pages, slides, or nothing (Word, plain text). */
export type PageUnit = "page" | "slide" | null;

/**
 * A line that looks like a heading: short, not sentence-punctuated, and
 * either numbered, title-cased or shouting. Deliberately conservative — a
 * wrong heading is worse than no heading, because it mislabels a citation.
 */
export function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 90) return false;
  if (/[.!?,;]$/.test(trimmed)) return false;
  if (/^#{1,6}\s+/.test(trimmed)) return true;
  if (/^(chapter|section|unit|module|lesson|part|topic)\b/i.test(trimmed)) return true;
  if (/^\d+(\.\d+)*[.)]?\s+\S/.test(trimmed) && trimmed.length < 70) return true;
  if (trimmed === trimmed.toUpperCase() && /[A-Z]{3}/.test(trimmed)) return true;
  return false;
}

/**
 * Splits text into paragraph blocks under the nearest heading. `startHeading`
 * carries a heading over from the previous page, so a chapter that spans
 * several PDF pages keeps its heading on every page.
 */
export function extractPlainText(text: string, startHeading?: string, page?: number): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  let heading = startHeading;
  let buffer: string[] = [];

  const flush = () => {
    const joined = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (joined) blocks.push({ heading, text: joined, page });
    buffer = [];
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    if (looksLikeHeading(line)) {
      flush();
      heading = line.replace(/^#{1,6}\s+/, "");
      blocks.push({ heading, text: heading, page });
      continue;
    }
    buffer.push(line);
  }
  flush();

  return blocks;
}

/** Blocks for a PDF given its per-page text, carrying headings across page breaks. */
export function blocksFromPages(pages: { num: number; text: string }[]): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  let heading: string | undefined;
  for (const page of [...pages].sort((a, b) => a.num - b.num)) {
    const pageBlocks = extractPlainText(page.text, heading, page.num);
    if (pageBlocks.length > 0) heading = pageBlocks[pageBlocks.length - 1].heading;
    blocks.push(...pageBlocks);
  }
  return blocks;
}

/** "p. 12", "pp. 12–13", "slide 4", or undefined when the document has no pages. */
export function formatLocator(unit: PageUnit, start?: number, end?: number): string | undefined {
  if (!unit || start === undefined) return undefined;
  const last = end ?? start;
  if (unit === "slide") return last === start ? `slide ${start}` : `slides ${start}–${last}`;
  return last === start ? `p. ${start}` : `pp. ${start}–${last}`;
}
