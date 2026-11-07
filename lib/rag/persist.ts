import type { KnowledgeChunk, OutlineChapter } from "@/lib/types";
import type { PageUnit } from "./blocks";

/**
 * Shared, short-lived storage for uploaded documents, so any server instance
 * can answer for a document another instance indexed (on Vercel, the upload
 * and the next request often land on different instances).
 *
 * Pure apart from the injected key-value store, so it can be tested with a
 * fake one. lib/rag/store.ts wires it to Upstash Redis.
 *
 * Privacy and cost limits:
 *   - every document expires DOCUMENT_TTL_SECONDS after upload (no refresh on read);
 *   - a stored document is at most MAX_STORED_BYTES. Embedding vectors are
 *     quantised to int8 (about 8x smaller than JSON floats); if that is still
 *     too big the vectors are dropped and retrieval falls back to lexical; if
 *     the text alone is too big the document is not stored at all.
 */

export const DOCUMENT_TTL_SECONDS = 24 * 60 * 60;
export const MAX_STORED_BYTES = 2_000_000;
const FORMAT_VERSION = 1;

export interface PersistedDocument {
  docId: string;
  fileName: string;
  charCount: number;
  chunks: KnowledgeChunk[];
  /** Parallel to chunks; empty when the document is indexed lexically. */
  vectors: number[][];
  retrieval: "embeddings" | "lexical";
  pageUnit: PageUnit;
  outline: OutlineChapter[];
  /** Epoch ms. */
  indexedAt: number;
}

/** The two calls this module needs from Redis (or a test fake). Values are strings. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export const documentKey = (docId: string) => `doc:${docId}`;

// ---- Vector quantisation ------------------------------------------------------

/** float vector -> base64 of [float32 scale][int8 x n]. Cosine similarity survives almost unchanged. */
export function quantiseVector(vector: number[]): string {
  const maxAbs = vector.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  const scale = maxAbs > 0 ? maxAbs / 127 : 1;
  const bytes = Buffer.alloc(4 + vector.length);
  bytes.writeFloatLE(scale, 0);
  vector.forEach((x, i) => bytes.writeInt8(Math.max(-127, Math.min(127, Math.round(x / scale))), 4 + i));
  return bytes.toString("base64");
}

export function dequantiseVector(encoded: string): number[] {
  const bytes = Buffer.from(encoded, "base64");
  const scale = bytes.readFloatLE(0);
  const out = new Array<number>(bytes.length - 4);
  for (let i = 4; i < bytes.length; i++) out[i - 4] = bytes.readInt8(i) * scale;
  return out;
}

// ---- Encoding -----------------------------------------------------------------

export interface EncodedDocument {
  payload: string;
  vectorsKept: boolean;
}

/** Serialises a document within maxBytes, dropping vectors if needed. Null if even the text doesn't fit. */
export function encodeDocument(doc: PersistedDocument, maxBytes = MAX_STORED_BYTES): EncodedDocument | null {
  const base = {
    v: FORMAT_VERSION,
    docId: doc.docId,
    fileName: doc.fileName,
    charCount: doc.charCount,
    chunks: doc.chunks,
    pageUnit: doc.pageUnit,
    outline: doc.outline,
    indexedAt: doc.indexedAt,
  };
  if (doc.vectors.length === doc.chunks.length && doc.vectors.length > 0) {
    const payload = JSON.stringify({ ...base, retrieval: "embeddings", vectors: doc.vectors.map(quantiseVector) });
    if (Buffer.byteLength(payload) <= maxBytes) return { payload, vectorsKept: true };
  }
  const payload = JSON.stringify({ ...base, retrieval: "lexical", vectors: [] });
  return Buffer.byteLength(payload) <= maxBytes ? { payload, vectorsKept: false } : null;
}

/** Parses a stored payload. Null for anything malformed or from another format version. */
export function decodeDocument(payload: string): PersistedDocument | null {
  try {
    const raw = JSON.parse(payload) as Record<string, unknown>;
    if (raw.v !== FORMAT_VERSION) return null;
    if (typeof raw.docId !== "string" || typeof raw.fileName !== "string") return null;
    if (!Array.isArray(raw.chunks) || !Array.isArray(raw.outline) || !Array.isArray(raw.vectors)) return null;
    if (typeof raw.indexedAt !== "number" || typeof raw.charCount !== "number") return null;
    const vectors = (raw.vectors as unknown[]).map((v) => dequantiseVector(String(v)));
    const chunks = raw.chunks as KnowledgeChunk[];
    const usable = vectors.length === chunks.length && vectors.length > 0;
    return {
      docId: raw.docId,
      fileName: raw.fileName,
      charCount: raw.charCount,
      chunks,
      vectors: usable ? vectors : [],
      retrieval: usable ? "embeddings" : "lexical",
      pageUnit: (raw.pageUnit as PageUnit) ?? null,
      outline: raw.outline as OutlineChapter[],
      indexedAt: raw.indexedAt,
    };
  } catch {
    return null;
  }
}

// ---- Save / load ---------------------------------------------------------------

export type SaveResult = "stored" | "stored_without_vectors" | "too_large" | "failed";

/** Never throws: a storage failure leaves the document in memory on this instance only. */
export async function saveDocument(
  kv: KeyValueStore,
  doc: PersistedDocument,
  maxBytes = MAX_STORED_BYTES,
): Promise<SaveResult> {
  const encoded = encodeDocument(doc, maxBytes);
  if (!encoded) return "too_large";
  try {
    await kv.set(documentKey(doc.docId), encoded.payload, DOCUMENT_TTL_SECONDS);
    return encoded.vectorsKept ? "stored" : "stored_without_vectors";
  } catch {
    return "failed";
  }
}

/** Never throws: unknown, expired, malformed or unreachable all mean null. */
export async function loadDocument(kv: KeyValueStore, docId: string, now = Date.now()): Promise<PersistedDocument | null> {
  try {
    const payload = await kv.get(documentKey(docId));
    if (!payload) return null;
    const doc = decodeDocument(payload);
    if (!doc || doc.docId !== docId || isExpired(doc, now)) return null;
    return doc;
  } catch {
    return null;
  }
}

/** Belt and braces: Redis expires keys itself, and the in-memory copy uses the same rule. */
export function isExpired(doc: Pick<PersistedDocument, "indexedAt">, now = Date.now()): boolean {
  return now - doc.indexedAt > DOCUMENT_TTL_SECONDS * 1000;
}
