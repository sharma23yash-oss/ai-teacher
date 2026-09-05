import "server-only";
import type { KnowledgeChunk, RetrievedChunk } from "@/lib/types";
import type { ExtractedBlock } from "./extract";
import { cosineSimilarity, embedQuery, embedTexts } from "./embeddings";

/**
 * Chunking, indexing, and retrieval over one uploaded document.
 *
 * The index lives in a process-local Map. That is the honest choice for a
 * single-process app: it is a real vector store with real cosine retrieval,
 * it costs nothing to operate, and a dev-server restart simply drops it — for
 * which the upload route exposes a re-index path, so the client can rebuild
 * from the text it still holds rather than asking the student to upload again.
 *
 * Retrieval is hybrid on purpose. Dense vectors handle "explain the bit about
 * energy transfer" where the student's words never appear in the document;
 * lexical scoring handles "what does it say about zorvane", where an exact
 * rare term matters more than semantic neighbourhood. Weighting both beats
 * either one alone, and lexical keeps working when embeddings are down.
 */

const TARGET_CHUNK_CHARS = 900;
const CHUNK_OVERLAP_CHARS = 150;
const MIN_CHUNK_CHARS = 60;
const MAX_CHUNKS = 400;

/** Documents kept in memory at once, oldest evicted first. */
const MAX_DOCUMENTS = 8;

export interface IndexedDocument {
  docId: string;
  fileName: string;
  charCount: number;
  chunks: KnowledgeChunk[];
  /** Parallel to chunks; empty when the document was indexed lexically. */
  vectors: number[][];
  retrieval: "embeddings" | "lexical";
  /** Document frequency per term, for the lexical half of the score. */
  documentFrequency: Map<string, number>;
  averageLength: number;
  indexedAt: number;
}

/**
 * Held on globalThis, not in a module-level binding.
 *
 * Next.js compiles each route handler into its own module graph, and in dev
 * it re-evaluates them on every hot reload — so a plain `const documents =
 * new Map()` gives /api/upload and /api/teach two different Maps, and every
 * lookup from the teaching route misses. (Symptom: uploads succeed, and then
 * every turn reports the document as "not loaded".) Pinning the store to the
 * global object is the same singleton pattern Next's own docs use for
 * database clients, and it survives hot reloads as well as route boundaries.
 */
const STORE_KEY = Symbol.for("ai-teacher.rag.documents");

type GlobalWithStore = typeof globalThis & {
  [STORE_KEY]?: Map<string, IndexedDocument>;
};

const globalWithStore = globalThis as GlobalWithStore;

const documents: Map<string, IndexedDocument> =
  globalWithStore[STORE_KEY] ?? (globalWithStore[STORE_KEY] = new Map());

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/**
 * Packs blocks into chunks of roughly TARGET_CHUNK_CHARS, never splitting a
 * block across chunks unless the block is itself oversized, and carrying the
 * heading each chunk sat under so a citation can name it.
 */
export function chunkBlocks(blocks: ExtractedBlock[]): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  let buffer = "";
  let heading: string | undefined;

  const push = () => {
    const text = buffer.trim();
    if (text.length >= MIN_CHUNK_CHARS || (text && chunks.length === 0)) {
      chunks.push({
        id: `c${chunks.length + 1}`,
        index: chunks.length + 1,
        heading,
        text,
      });
    }
    buffer = "";
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
  }

  push();
  return chunks;
}

// ---------------------------------------------------------------------------
// Lexical scoring (BM25)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for",
  "is", "are", "was", "were", "be", "been", "it", "its", "this", "that",
  "these", "those", "as", "by", "with", "from", "what", "which", "how", "why",
  "me", "my", "i", "you", "your", "we", "our", "can", "do", "does", "did",
]);

/** Unicode-aware: Devanagari, Tamil and CJK text must tokenise, not vanish. */
export function tokenize(text: string): string[] {
  const lowered = text.toLowerCase();
  const matches = lowered.match(/[\p{L}\p{N}]+/gu) ?? [];
  return matches.filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function buildDocumentFrequency(chunks: KnowledgeChunk[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const chunk of chunks) {
    for (const term of new Set(tokenize(chunk.text))) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  return df;
}

const BM25_K1 = 1.2;
const BM25_B = 0.75;

function bm25Score(
  queryTerms: string[],
  chunk: KnowledgeChunk,
  df: Map<string, number>,
  totalChunks: number,
  averageLength: number,
): number {
  const tokens = tokenize(chunk.text);
  if (tokens.length === 0) return 0;

  const termFrequency = new Map<string, number>();
  for (const token of tokens) {
    termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
  }

  let score = 0;
  for (const term of queryTerms) {
    const tf = termFrequency.get(term);
    if (!tf) continue;
    const n = df.get(term) ?? 0;
    const idf = Math.log(1 + (totalChunks - n + 0.5) / (n + 0.5));
    const denominator =
      tf + BM25_K1 * (1 - BM25_B + (BM25_B * tokens.length) / (averageLength || 1));
    score += idf * ((tf * (BM25_K1 + 1)) / denominator);
  }
  return score;
}

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

function evictIfNeeded() {
  while (documents.size > MAX_DOCUMENTS) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [key, doc] of documents) {
      if (doc.indexedAt < oldestAt) {
        oldestAt = doc.indexedAt;
        oldestKey = key;
      }
    }
    if (!oldestKey) break;
    documents.delete(oldestKey);
  }
}

export async function indexDocument(
  docId: string,
  fileName: string,
  blocks: ExtractedBlock[],
): Promise<IndexedDocument> {
  const chunks = chunkBlocks(blocks);
  const charCount = chunks.reduce((total, chunk) => total + chunk.text.length, 0);

  // A heading gives a passage meaning the passage itself may not carry
  // ("41 degrees" means little; "Key Numbers — 41 degrees" means a lot), so
  // it is embedded with the text rather than kept only for display.
  const embeddingInputs = chunks.map((chunk) =>
    chunk.heading ? `${chunk.heading}\n${chunk.text}` : chunk.text,
  );

  const vectors = (await embedTexts(embeddingInputs)) ?? [];
  const usable = vectors.length === chunks.length && chunks.length > 0;

  const document: IndexedDocument = {
    docId,
    fileName,
    charCount,
    chunks,
    vectors: usable ? vectors : [],
    retrieval: usable ? "embeddings" : "lexical",
    documentFrequency: buildDocumentFrequency(chunks),
    averageLength:
      chunks.length > 0
        ? chunks.reduce((total, chunk) => total + tokenize(chunk.text).length, 0) / chunks.length
        : 0,
    indexedAt: Date.now(),
  };

  documents.set(docId, document);
  evictIfNeeded();
  return document;
}

export function getDocument(docId: string): IndexedDocument | undefined {
  return documents.get(docId);
}

export function hasDocument(docId: string): boolean {
  return documents.has(docId);
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export interface RetrieveOptions {
  /** The student's message for this turn. */
  query: string;
  /** The concept being taught, mixed into the query so retrieval follows the lesson. */
  conceptHint?: string;
  topK?: number;
}

function normalise(scores: number[]): number[] {
  const max = Math.max(...scores, 0);
  if (max <= 0) return scores.map(() => 0);
  return scores.map((score) => score / max);
}

/**
 * Returns the passages most relevant to this turn, best first.
 * Never throws: an embedding failure degrades to lexical, and an unknown
 * docId returns an empty list, which the prompt reports honestly.
 */
export async function retrieve(
  docId: string,
  { query, conceptHint, topK = 5 }: RetrieveOptions,
): Promise<RetrievedChunk[]> {
  const document = documents.get(docId);
  if (!document || document.chunks.length === 0) return [];

  const searchText = conceptHint ? `${conceptHint}. ${query}` : query;
  const queryTerms = tokenize(searchText);

  const lexical = document.chunks.map((chunk) =>
    bm25Score(
      queryTerms,
      chunk,
      document.documentFrequency,
      document.chunks.length,
      document.averageLength,
    ),
  );

  let dense: number[] | null = null;
  if (document.vectors.length === document.chunks.length) {
    const queryVector = await embedQuery(searchText);
    if (queryVector) {
      dense = document.vectors.map((vector) => cosineSimilarity(queryVector, vector));
    }
  }

  const lexicalNorm = normalise(lexical);
  const combined = document.chunks.map((chunk, i) => {
    const score = dense ? 0.65 * dense[i] + 0.35 * lexicalNorm[i] : lexicalNorm[i];
    return { ...chunk, score };
  });

  return combined
    .filter((chunk) => chunk.score > 0.001)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * The opening slice of a document, used on the very first turn when there is
 * no student question to retrieve against yet — the model needs to see enough
 * to plan a syllabus, not five paragraphs matched against "teach me this".
 */
export function leadingContext(docId: string, maxChars = 6000): RetrievedChunk[] {
  const document = documents.get(docId);
  if (!document) return [];

  const out: RetrievedChunk[] = [];
  let used = 0;
  for (const chunk of document.chunks) {
    if (used + chunk.text.length > maxChars) break;
    out.push({ ...chunk, score: 1 });
    used += chunk.text.length;
  }
  return out.length > 0 ? out : document.chunks.slice(0, 1).map((c) => ({ ...c, score: 1 }));
}
