import { env } from "@/lib/env";
import { createClient } from "@supabase/supabase-js";
import type {
  DocumentInfo,
  EmbeddedChunk,
  ScoredChunk,
} from "@/lib/types";

/**
 * Supabase Vector Store
 */

const supabase = createClient(env.supabase.url, env.supabase.anonKey);

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function indexStats(): {
  documents: number;
  chunks: number;
  dimension: number;
  model: string;
} {
  // Not synchronously available via Supabase API without a query
  // For UI purposes, we'll return a placeholder or we can change the API later.
  return {
    documents: 0,
    chunks: 0,
    dimension: 768,
    model: env.ollama.embedModel,
  };
}

export async function addDocument(
  doc: DocumentInfo,
  chunks: EmbeddedChunk[],
  dimension: number
): Promise<void> {
  // 1. Insert document metadata
  const { error: docError } = await supabase.from("documents").insert({
    id: doc.id,
    name: doc.name,
    created_at: new Date(doc.createdAt).toISOString(),
  });

  if (docError && docError.code !== "23505") { // Ignore unique violation if re-ingesting
    console.error("Failed to insert document metadata:", docError);
    throw new Error("Supabase insert failed: " + docError.message);
  }

  // 2. Insert chunks in batches to avoid Supabase statement timeouts
  const rows = chunks.map((ch) => ({
    id: ch.id,
    doc_id: ch.docId,
    doc_name: ch.docName,
    page: ch.page,
    chunk_index: ch.chunkIndex,
    text: ch.text,
    embedding: ch.vector, // Supabase pgvector accepts JS arrays directly
  }));

  const BATCH_SIZE = 100;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error: chunkError } = await supabase.from("document_chunks").insert(batch);

    if (chunkError) {
      console.error(`Failed to insert document chunks (batch ${i}):`, chunkError);
      throw new Error("Supabase insert failed: " + chunkError.message);
    }
  }
}

export async function removeDocument(docId: string): Promise<boolean> {
  // Cascading delete handles chunks
  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("id", docId);
  return !error;
}

export async function listDocuments(): Promise<DocumentInfo[]> {
  const { data, error } = await supabase
    .from("documents")
    .select(`
      id,
      name,
      created_at,
      document_chunks (count)
    `)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data.map((d: any) => ({
    id: d.id,
    name: d.name,
    chunks: d.document_chunks[0].count,
    createdAt: new Date(d.created_at).getTime(),
    size: 0,
    pages: null,
  }));
}

export async function clearIndex(): Promise<void> {
  await supabase.from("documents").delete().neq("id", "00000000-0000-0000-0000-000000000000"); // Deletes all
}

export interface SearchOptions {
  topK: number;
  docIds?: string[];
  threshold?: number;
}

export async function search(
  queryVector: number[],
  opts: SearchOptions
): Promise<ScoredChunk[]> {
  // Format vector as string for Postgres function: '[0.1, 0.2, ...]'
  const vectorStr = `[${queryVector.join(",")}]`;

  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: vectorStr,
    match_threshold: opts.threshold ?? 0,
    match_count: opts.topK,
    filter_doc_ids: opts.docIds && opts.docIds.length > 0 ? opts.docIds : null,
  });

  if (error || !data) {
    console.error("Supabase search failed:", error);
    return [];
  }

  return data.map((row: any) => ({
    id: row.id,
    docId: row.doc_id,
    docName: row.doc_name,
    page: row.page,
    chunkIndex: row.chunk_index,
    text: row.text,
    score: row.similarity,
    rerankScore: row.similarity,
  }));
}

// ── Backwards compatibility stubs for UI sync ────────────────────────────

export function load(): any { return {}; }
export function persistNow(): void {}