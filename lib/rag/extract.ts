import "server-only";
import { PDFParse } from "pdf-parse";
import { readZipDirectory, readZipEntryText } from "./zip";

/**
 * Turns an uploaded file into plain text plus the structure worth keeping.
 *
 * Structure matters more than it looks: "which heading was this passage
 * under" and "which slide did it come from" are what let a retrieved chunk be
 * cited back to the student as a place in their own document rather than as
 * an anonymous quote.
 */

export type SourceKind = "pdf" | "docx" | "pptx" | "text";

export interface ExtractedBlock {
  /** Nearest enclosing heading, chapter, or slide title. */
  heading?: string;
  text: string;
}

export interface ExtractedDocument {
  kind: SourceKind;
  blocks: ExtractedBlock[];
  /** Everything joined back together — what the first turn is grounded in. */
  text: string;
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeXmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] ?? entity);
}

/** Collects the text of every occurrence of one XML tag, in document order. */
function collectTagText(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    out.push(decodeXmlText(match[1].replace(/<[^>]*>/g, "")));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------

function extractDocxXml(xml: string): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  let heading: string | undefined;

  // One <w:p> is one paragraph. Its style tells us whether it is a heading,
  // and the <w:t> runs inside it hold the visible text.
  const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];

  for (const paragraph of paragraphs) {
    const text = collectTagText(paragraph, "w:t").join("").replace(/\s+/g, " ").trim();
    if (!text) continue;

    const styleMatch = paragraph.match(/<w:pStyle\s+w:val="([^"]+)"/);
    const style = styleMatch?.[1] ?? "";
    const isHeading = /^(Heading|Title|Subtitle)/i.test(style);

    if (isHeading) {
      heading = text;
      blocks.push({ heading, text });
    } else {
      blocks.push({ heading, text });
    }
  }

  return blocks;
}

async function extractDocx(buffer: Uint8Array): Promise<ExtractedBlock[]> {
  const entries = readZipDirectory(buffer);
  const main = entries.find((entry) => entry.name === "word/document.xml");
  if (!main) {
    throw new Error("That .docx has no word/document.xml — it may be corrupt.");
  }
  return extractDocxXml(await readZipEntryText(buffer, main));
}

// ---------------------------------------------------------------------------
// PowerPoint
// ---------------------------------------------------------------------------

function slideNumber(name: string): number {
  const match = name.match(/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

async function extractPptx(buffer: Uint8Array): Promise<ExtractedBlock[]> {
  const entries = readZipDirectory(buffer)
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name))
    .sort((a, b) => slideNumber(a.name) - slideNumber(b.name));

  if (entries.length === 0) {
    throw new Error("That .pptx has no slides in it.");
  }

  const blocks: ExtractedBlock[] = [];

  for (const entry of entries) {
    const xml = await readZipEntryText(buffer, entry);
    // <a:t> holds every run of visible text on a slide, title included.
    const runs = collectTagText(xml, "a:t")
      .map((run) => run.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (runs.length === 0) continue;

    const n = slideNumber(entry.name);
    // The first run on a slide is almost always its title placeholder, which
    // makes a far better citation label than "slide 7".
    const heading = `Slide ${n}: ${runs[0]}`.slice(0, 120);
    blocks.push({ heading, text: runs.join(" · ") });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// PDF and plain text
// ---------------------------------------------------------------------------

/**
 * A line that looks like a heading: short, not sentence-punctuated, and
 * either numbered, title-cased or shouting. Deliberately conservative — a
 * wrong heading is worse than no heading, because it mislabels a citation.
 */
function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 90) return false;
  if (/[.!?,;]$/.test(trimmed)) return false;
  if (/^#{1,6}\s+/.test(trimmed)) return true;
  if (/^(chapter|section|unit|module|lesson|part|topic)\b/i.test(trimmed)) return true;
  if (/^\d+(\.\d+)*[.)]?\s+\S/.test(trimmed) && trimmed.length < 70) return true;
  if (trimmed === trimmed.toUpperCase() && /[A-Z]{3}/.test(trimmed)) return true;
  return false;
}

function extractPlainText(text: string): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  let heading: string | undefined;
  let buffer: string[] = [];

  const flush = () => {
    const joined = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (joined) blocks.push({ heading, text: joined });
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
      blocks.push({ heading, text: heading });
      continue;
    }
    buffer.push(line);
  }
  flush();

  return blocks;
}

async function extractPdf(buffer: Uint8Array): Promise<ExtractedBlock[]> {
  const parser = new PDFParse({ data: Buffer.from(buffer) });
  try {
    const result = await parser.getText();
    return extractPlainText(result.text);
  } finally {
    await parser.destroy();
  }
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Content sniffing — confirms the bytes match the claimed type
// ---------------------------------------------------------------------------

function startsWithSignature(buffer: Uint8Array, signature: readonly number[]): boolean {
  if (buffer.length < signature.length) return false;
  return signature.every((byte, i) => buffer[i] === byte);
}

/**
 * Plain text has no magic number, so this checks the shape instead: mostly
 * printable ASCII/whitespace or UTF-8 continuation bytes, and no embedded
 * NUL. Rejects binary content that only happens to carry a .txt/.md name or
 * a text/* MIME type, which a client fully controls and a server must not
 * trust on its own.
 */
function looksLikeText(buffer: Uint8Array): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.length === 0) return true;
  if (sample.includes(0)) return false;

  let suspicious = 0;
  for (const byte of sample) {
    const isPrintableAscii = byte >= 0x20 && byte <= 0x7e;
    const isCommonWhitespace = byte === 0x09 || byte === 0x0a || byte === 0x0d;
    const isUtf8Continuation = byte >= 0x80;
    if (!isPrintableAscii && !isCommonWhitespace && !isUtf8Continuation) suspicious++;
  }
  return suspicious / sample.length < 0.02;
}

/**
 * Confirms the file's actual bytes match the type detectKind() derived from
 * its name/MIME — both of which the uploading client fully controls. A
 * renamed executable, a zip bomb wearing a ".pdf" extension, or any other
 * MIME-spoofed upload is caught here before extraction ever runs on it.
 */
export function sniffKind(buffer: Uint8Array, claimedKind: SourceKind): boolean {
  switch (claimedKind) {
    case "pdf":
      // "%PDF"
      return startsWithSignature(buffer, [0x25, 0x50, 0x44, 0x46]);
    case "docx":
    case "pptx":
      // Office Open XML files are ZIP archives: a normal local-file-header
      // signature, or (rarely, for a technically-empty archive) the
      // end-of-central-directory signature on its own.
      return (
        startsWithSignature(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
        startsWithSignature(buffer, [0x50, 0x4b, 0x05, 0x06])
      );
    case "text":
      return looksLikeText(buffer);
  }
}

export function detectKind(fileName: string, mimeType: string): SourceKind | null {
  const name = fileName.toLowerCase();
  if (name.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".pptx")) return "pptx";
  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown")) return "text";
  if (mimeType.startsWith("text/")) return "text";
  if (mimeType.includes("wordprocessingml")) return "docx";
  if (mimeType.includes("presentationml")) return "pptx";
  return null;
}

export async function extractDocument(
  buffer: Uint8Array,
  kind: SourceKind,
): Promise<ExtractedDocument> {
  let blocks: ExtractedBlock[];

  switch (kind) {
    case "pdf":
      blocks = await extractPdf(buffer);
      break;
    case "docx":
      blocks = await extractDocx(buffer);
      break;
    case "pptx":
      blocks = await extractPptx(buffer);
      break;
    default:
      blocks = extractPlainText(new TextDecoder("utf-8").decode(buffer));
  }

  blocks = blocks.filter((block) => block.text.trim().length > 0);

  return {
    kind,
    blocks,
    text: blocks.map((block) => block.text).join("\n\n"),
  };
}
