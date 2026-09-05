import "server-only";
import { GoogleGenAI } from "@google/genai";

/**
 * Embeddings for the retrieval layer.
 *
 * This module is written so that it can fail completely without taking a
 * lesson down with it. Every export returns null rather than throwing when
 * Gemini is unconfigured, the model name has moved on, or the network is
 * unavailable — the retriever then falls back to lexical scoring, which is
 * worse but still grounded in the student's actual document. A lesson that
 * degrades is acceptable; a lesson that 500s because an embedding call
 * timed out is not.
 */

/**
 * Tried in order on first use, and the first one that answers is cached for
 * the process. Google has renamed this endpoint more than once, and hardcoding
 * a single name is how the RAG path silently dies six months from now.
 */
const EMBEDDING_MODEL_CANDIDATES = [
  "gemini-embedding-001",
  "text-embedding-004",
  "embedding-001",
];

/** Gemini caps a batch; well under it, and small enough to stay responsive. */
const BATCH_SIZE = 32;
const EMBED_TIMEOUT_MS = 20_000;

let client: GoogleGenAI | null = null;
let resolvedModel: string | null = null;
let modelResolutionFailed = false;

function getClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

export function isEmbeddingConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY) && !modelResolutionFailed;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Embedding request timed out.")), ms),
    ),
  ]);
}

async function embedBatch(
  ai: GoogleGenAI,
  model: string,
  texts: string[],
): Promise<number[][] | null> {
  try {
    const response = await withTimeout(
      ai.models.embedContent({ model, contents: texts }),
      EMBED_TIMEOUT_MS,
    );
    const vectors = response.embeddings
      ?.map((entry) => entry.values)
      .filter((values): values is number[] => Array.isArray(values) && values.length > 0);

    if (!vectors || vectors.length !== texts.length) return null;
    return vectors;
  } catch {
    return null;
  }
}

/** Finds an embedding model this key can actually reach, once per process. */
async function resolveModel(ai: GoogleGenAI): Promise<string | null> {
  if (resolvedModel) return resolvedModel;
  if (modelResolutionFailed) return null;

  for (const candidate of EMBEDDING_MODEL_CANDIDATES) {
    const probe = await embedBatch(ai, candidate, ["probe"]);
    if (probe) {
      resolvedModel = candidate;
      console.info(`[rag] embeddings using ${candidate}`);
      return candidate;
    }
  }

  modelResolutionFailed = true;
  console.warn("[rag] no embedding model reachable — retrieval will run lexical-only.");
  return null;
}

/**
 * Embeds a list of texts. Returns null if embeddings are unavailable for any
 * reason, which the caller must treat as "index this document lexically".
 */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) return [];

  const ai = getClient();
  if (!ai) return null;

  const model = await resolveModel(ai);
  if (!model) return null;

  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = await embedBatch(ai, model, texts.slice(i, i + BATCH_SIZE));
    if (!batch) return null;
    vectors.push(...batch);
  }
  return vectors;
}

/** Embeds one query string. Null means "score this turn lexically". */
export async function embedQuery(text: string): Promise<number[] | null> {
  const vectors = await embedTexts([text]);
  return vectors && vectors.length === 1 ? vectors[0] : null;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
