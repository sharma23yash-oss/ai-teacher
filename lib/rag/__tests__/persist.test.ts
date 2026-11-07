import { describe, expect, it } from "vitest";
import type { KnowledgeChunk } from "@/lib/types";
import {
  decodeDocument,
  dequantiseVector,
  DOCUMENT_TTL_SECONDS,
  documentKey,
  encodeDocument,
  loadDocument,
  quantiseVector,
  saveDocument,
  type KeyValueStore,
  type PersistedDocument,
} from "../persist";

/** A fake Redis shared by two "servers": stores strings and remembers each key's TTL. */
function fakeRedis() {
  const data = new Map<string, string>();
  const ttls = new Map<string, number>();
  const kv: KeyValueStore = {
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value, ttlSeconds) {
      data.set(key, value);
      ttls.set(key, ttlSeconds);
    },
  };
  return { kv, data, ttls };
}

const DIMS = 768;
const vector = (seed: number) => Array.from({ length: DIMS }, (_, i) => Math.sin(seed * 31 + i * 0.7) * 0.05);
const cosine = (a: number[], b: number[]) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  a.forEach((x, i) => {
    dot += x * b[i];
    na += x * x;
    nb += b[i] * b[i];
  });
  return dot / Math.sqrt(na * nb);
};

function makeDoc(chunkCount = 3, textSize = 200): PersistedDocument {
  const chunks: KnowledgeChunk[] = Array.from({ length: chunkCount }, (_, i) => ({
    id: `c${i + 1}`,
    index: i + 1,
    heading: "Chapter 2: Duration",
    text: "x".repeat(textSize),
    pageStart: 3,
    pageEnd: 3,
    locator: "p. 3",
  }));
  return {
    docId: "6f1c2a8e-0b7d-4a43-9d3e-2f5b8c1d9e70",
    fileName: "bonds.pdf",
    charCount: chunkCount * textSize,
    chunks,
    vectors: chunks.map((_, i) => vector(i + 1)),
    retrieval: "embeddings",
    pageUnit: "page",
    outline: [{ id: "ch1", title: "Chapter 2: Duration", locator: "p. 3", pageStart: 3, pageEnd: 3, chunkIds: chunks.map((c) => c.id) }],
    indexedAt: Date.now(),
  };
}

describe("document persistence", () => {
  it("lets a second server read a document the first one indexed", async () => {
    const redis = fakeRedis();
    const doc = makeDoc();
    // Server A indexes the upload...
    expect(await saveDocument(redis.kv, doc)).toBe("stored");
    // ...server B, with nothing in memory, answers the chapter summary.
    const loaded = await loadDocument(redis.kv, doc.docId);
    expect(loaded?.fileName).toBe("bonds.pdf");
    expect(loaded?.outline[0].chunkIds).toEqual(["c1", "c2", "c3"]);
    expect(loaded?.chunks[0].locator).toBe("p. 3");
    expect(loaded?.retrieval).toBe("embeddings");
  });

  it("stores under doc:<id> with a 24-hour expiry", async () => {
    const redis = fakeRedis();
    const doc = makeDoc();
    await saveDocument(redis.kv, doc);
    expect(redis.ttls.get(documentKey(doc.docId))).toBe(24 * 60 * 60);
    expect(DOCUMENT_TTL_SECONDS).toBe(86_400);
  });

  it("treats a document older than 24 hours as gone", async () => {
    const redis = fakeRedis();
    const doc = makeDoc();
    await saveDocument(redis.kv, doc);
    const dayAndAMinuteLater = doc.indexedAt + DOCUMENT_TTL_SECONDS * 1000 + 60_000;
    expect(await loadDocument(redis.kv, doc.docId, dayAndAMinuteLater)).toBeNull();
  });

  it("keeps cosine similarity almost unchanged after quantising vectors", () => {
    const a = vector(1);
    const b = vector(2);
    const qa = dequantiseVector(quantiseVector(a));
    const qb = dequantiseVector(quantiseVector(b));
    expect(Math.abs(cosine(qa, qb) - cosine(a, b))).toBeLessThan(0.01);
    expect(cosine(qa, a)).toBeGreaterThan(0.999);
  });

  it("drops vectors to fit the size limit, then refuses documents that still don't fit", async () => {
    const doc = makeDoc(3, 200);
    const textOnly = encodeDocument({ ...doc, vectors: [] })!.payload.length;
    // Room for the text but not the vectors: stored, lexical only.
    const redis = fakeRedis();
    expect(await saveDocument(redis.kv, doc, textOnly + 100)).toBe("stored_without_vectors");
    expect((await loadDocument(redis.kv, doc.docId))?.retrieval).toBe("lexical");
    // Not even room for the text: not stored.
    const small = fakeRedis();
    expect(await saveDocument(small.kv, doc, 500)).toBe("too_large");
    expect(small.data.size).toBe(0);
  });

  it("never throws when Redis fails or holds garbage", async () => {
    const broken: KeyValueStore = {
      get: () => Promise.reject(new Error("down")),
      set: () => Promise.reject(new Error("down")),
    };
    const doc = makeDoc();
    expect(await saveDocument(broken, doc)).toBe("failed");
    expect(await loadDocument(broken, doc.docId)).toBeNull();
    expect(decodeDocument("not json")).toBeNull();
    expect(decodeDocument(JSON.stringify({ v: 99 }))).toBeNull();
  });

  it("returns null for an unknown document", async () => {
    expect(await loadDocument(fakeRedis().kv, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
