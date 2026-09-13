import { env } from "@/lib/env";
import { embedText } from "@/lib/ai/ollama";
import { search } from "@/lib/store/vectorStore";
import type { ScoredChunk } from "@/lib/types";

/**
 * Retrieval: embed the question and run cosine similarity search.
 * Returns the top-k most similar chunks in the vector index.
 * Plain vector search â€” no reranking, no web fallback.
 */

export interface RetrieveResult {
  chunks: ScoredChunk[];
  bestScore: number;
}

export async function retrieve(
  question: string,
  docIds?: string[]
): Promise<RetrieveResult> {
  const queryVector = await embedText(question);

  const candidates = await search(queryVector, {
    topK: env.retrieval.topK,
    docIds,
    threshold: 0,
  });

  if (candidates.length === 0) {
    return { chunks: [], bestScore: 0 };
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, env.retrieval.topK);

  return {
    chunks: top,
    bestScore: top[0].score,
  };
}