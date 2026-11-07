import type { KnowledgeChunk } from "@/lib/types";
import { formatLocator, type ExtractedBlock, type PageUnit } from "./blocks";

/**
 * Chunking for retrieval. Pure (no server-only imports) so it can be tested.
 * Each chunk keeps its heading and the page range it came from, so a citation
 * can point the student at "p. 12" of their own document.
 */

const TARGET_CHUNK_CHARS = 900;
const CHUNK_OVERLAP_CHARS = 150;
const MIN_CHUNK_CHARS = 60;
export const MAX_CHUNKS = 400;

/**
 * Packs blocks into chunks of roughly TARGET_CHUNK_CHARS, never splitting a
 * block across chunks unless the block is itself oversized, and carrying the
 * heading and page range each chunk came from.
 */
export function chunkBlocks(blocks: ExtractedBlock[], unit: PageUnit = null): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  let buffer = "";
  let heading: string | undefined;
  let pageStart: number | undefined;
  let pageEnd: number | undefined;

  const notePage = (page?: number) => {
    if (page === undefined) return;
    if (pageStart === undefined || page < pageStart) pageStart = page;
    if (pageEnd === undefined || page > pageEnd) pageEnd = page;
  };

  const push = () => {
    const text = buffer.trim();
    if (text.length >= MIN_CHUNK_CHARS || (text && chunks.length === 0)) {
      chunks.push({
        id: `c${chunks.length + 1}`,
        index: chunks.length + 1,
        heading,
        text,
        pageStart,
        pageEnd,
        locator: formatLocator(unit, pageStart, pageEnd),
      });
    }
    buffer = "";
    pageStart = undefined;
    pageEnd = undefined;
  };

  for (const block of blocks) {
    if (chunks.length >= MAX_CHUNKS) break;

    // A heading change is a natural seam — start a new chunk rather than
    // letting one passage carry two different headings' worth of context.
    if (block.heading !== heading && buffer.trim()) {
      push();
    }
    heading = block.heading;

    let text = block.text.trim();
    if (!text) continue;

    // An oversized single block (a wall-of-text PDF page) is split on
    // sentence boundaries with overlap, so a fact straddling the seam still
    // appears whole in one of the two chunks.
    while (text.length > TARGET_CHUNK_CHARS * 1.6) {
      const window = text.slice(0, TARGET_CHUNK_CHARS);
      const lastStop = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("। "),
        window.lastIndexOf("? "),
        window.lastIndexOf("! "),
      );
      const cut = lastStop > TARGET_CHUNK_CHARS * 0.5 ? lastStop + 1 : TARGET_CHUNK_CHARS;

      buffer = buffer ? `${buffer} ${text.slice(0, cut)}` : text.slice(0, cut);
      notePage(block.page);
      push();
      text = text.slice(Math.max(0, cut - CHUNK_OVERLAP_CHARS)).trim();
      if (chunks.length >= MAX_CHUNKS) return chunks;
    }

    const candidate = buffer ? `${buffer} ${text}` : text;
    if (candidate.length > TARGET_CHUNK_CHARS) {
      push();
      buffer = text;
    } else {
      buffer = candidate;
    }
    notePage(block.page);
  }

  push();
  return chunks;
}

/** How a passage is labelled in prompts and in the UI: page/slide, then heading. */
export function citationLabel(chunk: Pick<KnowledgeChunk, "locator" | "heading" | "index">): string {
  const parts = [chunk.locator, chunk.heading].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : `passage ${chunk.index}`;
}
