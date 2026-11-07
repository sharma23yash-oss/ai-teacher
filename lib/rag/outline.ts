import type { KnowledgeChunk, OutlineChapter } from "@/lib/types";
import { formatLocator, type PageUnit } from "./blocks";

/**
 * Splits an indexed document into chapters for "summarise this chapter" and
 * "practise this chapter". Pure, so it can be tested.
 *
 * Three strategies, in order:
 *   1. Major headings ("Chapter 3", "Unit 2", "Module 1", "Part IV", or
 *      top-level numbering such as "4. Valuation" but not "4.2 ...").
 *   2. Every distinct heading, when there are a sensible number of them.
 *   3. Even groups of passages, labelled by their page range.
 */

export const MAX_CHAPTERS = 24;
const PASSAGES_PER_GROUP = 6;

const MAJOR_HEADING =
  /^(?:(?:chapter|unit|module|part|section|lesson)\s+(?:\d+|[ivxlc]+)\b|\d+[.)]?\s+\D)/i;

export function isMajorHeading(heading: string | undefined): boolean {
  if (!heading) return false;
  const h = heading.trim();
  if (/^\d+\.\d+/.test(h)) return false; // "2.1 Sub-section"
  if (/^slide\s+\d+:/i.test(h)) return false; // every PPTX slide has one
  return MAJOR_HEADING.test(h);
}

function cleanTitle(title: string): string {
  return title.replace(/^#{1,6}\s+/, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function finish(groups: { title: string; chunks: KnowledgeChunk[] }[], unit: PageUnit): OutlineChapter[] {
  return groups
    .filter((group) => group.chunks.length > 0)
    .map((group, i) => {
      const pages = group.chunks.flatMap((c) => [c.pageStart, c.pageEnd]).filter((p): p is number => p !== undefined);
      const pageStart = pages.length > 0 ? Math.min(...pages) : undefined;
      const pageEnd = pages.length > 0 ? Math.max(...pages) : undefined;
      return {
        id: `ch${i + 1}`,
        title: cleanTitle(group.title) || `Part ${i + 1}`,
        locator: formatLocator(unit, pageStart, pageEnd),
        pageStart,
        pageEnd,
        chunkIds: group.chunks.map((c) => c.id),
      };
    });
}

function byMajorHeadings(chunks: KnowledgeChunk[]) {
  const groups: { title: string; chunks: KnowledgeChunk[] }[] = [];
  for (const chunk of chunks) {
    if (isMajorHeading(chunk.heading) && chunk.heading !== groups[groups.length - 1]?.title) {
      groups.push({ title: chunk.heading!, chunks: [chunk] });
    } else if (groups.length === 0) {
      groups.push({ title: "Introduction", chunks: [chunk] });
    } else {
      groups[groups.length - 1].chunks.push(chunk);
    }
  }
  return groups;
}

function byHeadings(chunks: KnowledgeChunk[]) {
  const groups: { title: string; chunks: KnowledgeChunk[] }[] = [];
  for (const chunk of chunks) {
    const title = chunk.heading ?? "Introduction";
    if (groups.length > 0 && groups[groups.length - 1].title === title) {
      groups[groups.length - 1].chunks.push(chunk);
    } else {
      groups.push({ title, chunks: [chunk] });
    }
  }
  return groups;
}

function byEvenGroups(chunks: KnowledgeChunk[], unit: PageUnit) {
  const groupCount = Math.min(MAX_CHAPTERS, Math.max(1, Math.ceil(chunks.length / PASSAGES_PER_GROUP)));
  const size = Math.ceil(chunks.length / groupCount);
  const groups: { title: string; chunks: KnowledgeChunk[] }[] = [];
  for (let i = 0; i < chunks.length; i += size) {
    const slice = chunks.slice(i, i + size);
    const first = slice[0];
    const last = slice[slice.length - 1];
    const range = formatLocator(unit, first.pageStart, last.pageEnd);
    const label = range ? range.replace(/^p{1,2}\. /, "Pages ").replace(/^slides? /, "Slides ") : `Part ${groups.length + 1}`;
    groups.push({ title: first.heading ? `${label}: ${first.heading}` : label, chunks: slice });
  }
  return groups;
}

export function buildOutline(chunks: KnowledgeChunk[], unit: PageUnit): OutlineChapter[] {
  if (chunks.length === 0) return [];

  const major = byMajorHeadings(chunks);
  const majorCount = major.filter((g) => g.title !== "Introduction").length;
  if (majorCount >= 2 && major.length <= MAX_CHAPTERS) return finish(major, unit);

  const headed = byHeadings(chunks);
  if (headed.length >= 2 && headed.length <= MAX_CHAPTERS) return finish(headed, unit);

  return finish(byEvenGroups(chunks, unit), unit);
}
