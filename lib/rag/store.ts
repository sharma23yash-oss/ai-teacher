import "server-only";
import { Redis } from "@upstash/redis";
import type { KnowledgeChunk, OutlineChapter, RetrievedChunk } from "@/lib/types";
import type { ExtractedBlock, PageUnit } from "./blocks";
import { chunkBlocks } from "./chunking";
import { buildOutline } from "./outline";
import { cosineSimilarity, embedQuery, embedTexts } from "./embeddings";
import { isExpired, loadDocument, saveDocument, type KeyValueStore, type PersistedDocument } from "./persist";

/**
 * Chunking, indexing, and retrieval over one uploaded document.
 *
 * Storage has two layers:
 *   - a process-local Map, the fast path for the instance that indexed the
 *     document (and the only layer when Upstash isn't configured);
 *   - Upstash Redis (lib/rag/persist.ts), so another serverless instance can
 *     load a document it never saw. Documents expire 24 hours after upload
 *     and are capped at 2 MB there; both layers apply the same expiry.
 * If both miss, the client still holds the extracted text and re-sends it,
 * so a lesson stays grounded.
 *
 * Retrieval is hybrid on purpose. Dense vectors handle "explain the bit about
 * energy transfer" where the student's words never appear in the document;
 * lexical scoring handles "what does it say about zorvane", where an exact
 * rare term matters more than semantic neighbourhood. Weighting both beats
 * either one alone, and lexical keeps working when embeddings are down.
 */

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
  pageUnit: PageUnit;
  outline: OutlineChapter[];
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

/** Upstash Redis when configured (same database as rate limits and metrics), else null. */
const sharedStore: KeyValueStore | null = (() => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  // Raw strings in and out: persist.ts does its own (validated) JSON.
  const redis = new Redis({ url, token, automaticDeserialization: false });
  return {
    get: (key) => redis.get<string>(key),
    set: async (key, value, ttlSeconds) => {
      await redis.set(key, value, { ex: ttlSeconds });
    },
  };
})();

export const isDocumentStoreShared = sharedStore !== null;

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

/** Adds the lexical-scoring fields, which are cheap to rebuild and so are not stored. */
function hydrate(doc: PersistedDocument): IndexedDocument {
  return {
    ...doc,
    documentFrequency: buildDocumentFrequency(doc.chunks),
    averageLength:
      doc.chunks.length > 0
        ? doc.chunks.reduce((total, chunk) => total + tokenize(chunk.text).length, 0) / doc.chunks.length
        : 0,
  };
}

export async function indexDocument(
  docId: string,
  fileName: string,
  blocks: ExtractedBlock[],
  pageUnit: PageUnit = null,
): Promise<IndexedDocument> {
  const chunks = chunkBlocks(blocks, pageUnit);
  const charCount = chunks.reduce((total, chunk) => total + chunk.text.length, 0);

  // A heading gives a passage meaning the passage itself may not carry
  // ("41 degrees" means little; "Key Numbers — 41 degrees" means a lot), so
  // it is embedded with the text rather than kept only for display.
  const embeddingInputs = chunks.map((chunk) =>
    chunk.heading ? `${chunk.heading}\n${chunk.text}` : chunk.text,
  );

  const vectors = (await embedTexts(embeddingInputs)) ?? [];
  const usable = vectors.length === chunks.length && chunks.length > 0;

  const document = hydrate({
    docId,
    fileName,
    charCount,
    chunks,
    vectors: usable ? vectors : [],
    retrieval: usable ? "embeddings" : "lexical",
    pageUnit,
    outline: buildOutline(chunks, pageUnit),
    indexedAt: Date.now(),
  });

  documents.set(docId, document);
  evictIfNeeded();

  if (sharedStore) {
    const persisted: PersistedDocument = {
      docId: document.docId,
      fileName: document.fileName,
      charCount: document.charCount,
      chunks: document.chunks,
      vectors: document.vectors,
      retrieval: document.retrieval,
      pageUnit: document.pageUnit,
      outline: document.outline,
      indexedAt: document.indexedAt,
    };
    const result = await saveDocument(sharedStore, persisted);
    if (result !== "stored") console.warn(`[rag] shared store: ${result} for ${docId}`);
  }
  return document;
}

/**
 * This instance's copy if it has one, else the shared store's. Undefined when
 * the document is unknown or more than 24 hours old.
 */
export async function getDocument(docId: string): Promise<IndexedDocument | undefined> {
  const local = documents.get(docId);
  if (local) {
    if (!isExpired(local)) return local;
    documents.delete(docId);
    return undefined;
  }
  if (!sharedStore) return undefined;
  const stored = await loadDocument(sharedStore, docId);
  if (!stored) return undefined;
  const document = hydrate(stored);
  documents.set(docId, document);
  evictIfNeeded();
  return document;
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
  const document = await getDocument(docId);
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
export async function leadingContext(docId: string, maxChars = 6000): Promise<RetrievedChunk[]> {
  const document = await getDocument(docId);
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

/**
 * The passages of one outline chapter, in document order, capped at maxChars
 * so a long chapter still fits one prompt. Empty if the document or chapter
 * is unknown.
 */
export async function chapterChunks(docId: string, chapterId: string, maxChars = 12_000): Promise<KnowledgeChunk[]> {
  const document = await getDocument(docId);
  const chapter = document?.outline.find((c) => c.id === chapterId);
  if (!document || !chapter) return [];
  const wanted = new Set(chapter.chunkIds);
  const out: KnowledgeChunk[] = [];
  let used = 0;
  for (const chunk of document.chunks) {
    if (!wanted.has(chunk.id)) continue;
    if (used + chunk.text.length > maxChars && out.length > 0) break;
    out.push(chunk);
    used += chunk.text.length;
  }
  return out;
}
