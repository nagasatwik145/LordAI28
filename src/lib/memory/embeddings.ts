/**
 * Embeddings for semantic memory retrieval.
 *
 * We prefer a real embedding model (OpenAI-compatible / OpenRouter embeddings)
 * when an API key is configured. When none is available (e.g. local dev, or a
 * deployment without an embeddings key) we transparently fall back to a small
 * deterministic TF-IDF bag-of-words vector so semantic retrieval still works
 * offline. Clients never need to know which backend produced the vector.
 *
 * Vectors are cached in-memory for the session to avoid re-embedding identical
 * text. The cache is keyed by the (text) content and is bounded.
 */

import { OPENAI_EMBEDDING_DIM } from "./constants";
import { readEnvApiKey } from "@/lib/env.server";

// Read env at call time, never at module scope: a module-level read is
// evaluated on first import, which can happen before the server has loaded its
// env files — the key would then stay `undefined` for the whole process even
// though it is configured.
function embeddingsApiUrl(): string {
  return process.env.LORD_EMBEDDINGS_URL || "https://openrouter.ai/api/v1/embeddings";
}
function embeddingsApiKey(): string | undefined {
  return readEnvApiKey("LORD_EMBEDDINGS_KEY") ?? readEnvApiKey("OPENROUTER_API_KEY");
}
function embeddingsModel(): string {
  return process.env.LORD_EMBEDDINGS_MODEL || "openai/text-embedding-3-small";
}

const cache = new Map<string, number[]>();
const MAX_CACHE = 2000;

export interface EmbeddingResult {
  vector: number[];
  /** "model" when a real embedding API was used, "tfidf" for the local fallback. */
  backend: "model" | "tfidf";
}

export function embeddingsConfigured(): boolean {
  return Boolean(embeddingsApiUrl() && embeddingsApiKey());
}

function normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

/** TF-IDF fallback: hashed token frequencies reduced to a fixed-dimension vector. */
function tfidfEmbedding(text: string): number[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  const vec = new Array(OPENAI_EMBEDDING_DIM).fill(0);
  const seen = new Set<string>();
  for (const t of tokens) {
    // hash token into a stable bucket
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const bucket = (h >>> 0) % OPENAI_EMBEDDING_DIM;
    // tf weighting; rare-ish words weigh slightly more
    vec[bucket] += seen.has(t) ? 1 : 1.5;
    seen.add(t);
  }
  // light positional signal for multi-word phrases
  if (tokens.length > 1) {
    const h2 = (tokens.join(" ").length * 2654435761) >>> 0;
    vec[h2 % OPENAI_EMBEDDING_DIM] += 0.5;
  }
  return normalize(vec);
}

export async function embed(text: string): Promise<EmbeddingResult> {
  const key = text.slice(0, 2000);
  const cached = cache.get(key);
  if (cached) return { vector: cached, backend: "model" };

  if (embeddingsConfigured()) {
    try {
      const res = await fetch(embeddingsApiUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${embeddingsApiKey()}`,
        },
        body: JSON.stringify({ model: embeddingsModel(), input: text }),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          data?: Array<{ embedding?: number[] }>;
        };
        const vector = json.data?.[0]?.embedding;
        if (Array.isArray(vector) && vector.length > 0) {
          const norm = normalize(vector);
          setCache(key, norm);
          return { vector: norm, backend: "model" };
        }
      }
    } catch {
      // fall through to TF-IDF
    }
  }

  const fallback = tfidfEmbedding(text);
  setCache(key, fallback);
  return { vector: fallback, backend: "tfidf" };
}

function setCache(key: string, vec: number[]) {
  if (cache.size >= MAX_CACHE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, vec);
}

/** Cosine similarity between two equal-length vectors, in [-1, 1]. */
export function cosineSimilarity(
  a: number[] | null | undefined,
  b: number[] | null | undefined,
): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both vectors are pre-normalized to unit length
}
