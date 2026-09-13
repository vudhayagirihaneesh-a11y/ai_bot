import fs from "fs";
import path from "path";
import { env, vectorPath } from "@/lib/env";
import type {
  DocumentInfo,
  EmbeddedChunk,
  ScoredChunk,
} from "@/lib/types";

/**
 * Persistent local vector store.
 *
 * Design: JSON file on disk (atomic writes), in-memory cache, cosine
 * similarity search with optional per-document filtering. The public API
 * (addDocument / removeDocument / listDocuments / search) intentionally
 * mirrors common vector DB clients (ChromaDB / pgvector style), so the
 * backing implementation can be swapped for a real vector DB later by
 * re-implementing this single module.
 */

interface StoredChunk {
  id: string;
  docId: string;
  docName: string;
  page: number | null;
  chunkIndex: number;
  text: string;
  vector: number[];
}

interface VectorIndexFile {
  version: 1;
  /** Embedding model the index was built with */
  model: string;
  dimension: number;
  documents: Record<string, DocumentInfo>;
  chunks: StoredChunk[];
}

interface VectorStoreState {
  index: VectorIndexFile;
  loaded: boolean;
  /** True while in-memory mutations have not been persisted yet */
  dirty: boolean;
  /** mtime of the index file as last seen — detects external writers (CLI ingest) */
  loadedMtime: number;
  persistTimer: NodeJS.Timeout | null;
}

// HMR-safe singleton (survives Next.js dev hot reloads)
const globalStore = globalThis as unknown as {
  __ragVectorStore?: VectorStoreState;
};

function state(): VectorStoreState {
  if (!globalStore.__ragVectorStore) {
    globalStore.__ragVectorStore = {
      index: {
        version: 1,
        model: env.ollama.embedModel,
        dimension: 0,
        documents: {},
        chunks: [],
      },
      loaded: false,
      dirty: false,
      loadedMtime: 0,
      persistTimer: null,
    };
  }
  return globalStore.__ragVectorStore;
}

// ── Persistence ───────────────────────────────────────────────────────────────

function diskMtime(): number {
  try {
    return fs.statSync(vectorPath).mtimeMs;
  } catch {
    return 0;
  }
}

function readDisk(): VectorIndexFile | null {
  try {
    if (!fs.existsSync(vectorPath)) return null;
    const parsed = JSON.parse(
      fs.readFileSync(vectorPath, "utf-8")
    ) as VectorIndexFile;
    if (parsed.version === 1 && parsed.model === env.ollama.embedModel) {
      return parsed;
    }
    return null;
  } catch (err) {
    console.error("[vectorStore] Failed to load index:", err);
    return null;
  }
}

function load(): VectorIndexFile {
  const s = state();
  if (!s.loaded) {
    const disk = readDisk();
    if (disk) s.index = disk;
    s.loaded = true;
    s.loadedMtime = diskMtime();
  } else if (!s.dirty) {
    // Pick up changes written by another process (e.g. `npm run ingest`
    // while the dev server is running). Skipped while we hold unsaved
    // mutations so a concurrent write cannot drop them.
    const mtime = diskMtime();
    if (mtime > s.loadedMtime) {
      const disk = readDisk();
      if (disk) s.index = disk;
      s.loadedMtime = mtime;
    }
  }
  s.index.model = env.ollama.embedModel;
  return s.index;
}

function persistSoon(): void {
  const s = state();
  if (s.persistTimer) clearTimeout(s.persistTimer);
  s.persistTimer = setTimeout(persistNow, 150);
}

export function persistNow(): void {
  const s = state();
  if (s.persistTimer) {
    clearTimeout(s.persistTimer);
    s.persistTimer = null;
  }
  const idx = load();
  fs.mkdirSync(path.dirname(vectorPath), { recursive: true });
  // Atomic write: tmp file + rename
  const tmp = `${vectorPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(idx), "utf-8");
  fs.renameSync(tmp, vectorPath);
  s.dirty = false;
  try {
    s.loadedMtime = fs.statSync(vectorPath).mtimeMs;
  } catch {
    s.loadedMtime = Date.now();
  }
}

// ── Cosine similarity ─────────────────────────────────────────────────────────

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

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function addDocument(
  doc: DocumentInfo,
  chunks: EmbeddedChunk[],
  dimension: number
): void {
  const idx = load();
  idx.documents[doc.id] = doc;
  // Replace previous chunks for this doc (re-ingest support)
  idx.chunks = idx.chunks.filter((c) => c.docId !== doc.id);
  for (const ch of chunks) {
    idx.chunks.push({
      id: ch.id,
      docId: ch.docId,
      docName: ch.docName,
      page: ch.page,
      chunkIndex: ch.chunkIndex,
      text: ch.text,
      vector: ch.vector,
    });
  }
  idx.dimension = dimension;
  idx.model = env.ollama.embedModel;
  state().dirty = true;
  persistSoon();
}

export function removeDocument(docId: string): boolean {
  const idx = load();
  if (!idx.documents[docId]) return false;
  delete idx.documents[docId];
  idx.chunks = idx.chunks.filter((c) => c.docId !== docId);
  state().dirty = true;
  persistSoon();
  return true;
}

export function listDocuments(): DocumentInfo[] {
  const idx = load();
  const counts: Record<string, number> = {};
  for (const c of idx.chunks) counts[c.docId] = (counts[c.docId] ?? 0) + 1;
  return Object.values(idx.documents)
    .map((d) => ({ ...d, chunks: counts[d.id] ?? 0 }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function indexStats(): {
  documents: number;
  chunks: number;
  dimension: number;
  model: string;
} {
  const idx = load();
  return {
    documents: Object.keys(idx.documents).length,
    chunks: idx.chunks.length,
    dimension: idx.dimension,
    model: idx.model,
  };
}

export function clearIndex(): void {
  const s = state();
  s.index = {
    version: 1,
    model: env.ollama.embedModel,
    dimension: 0,
    documents: {},
    chunks: [],
  };
  persistNow();
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface SearchOptions {
  topK: number;
  /** Only consider chunks from these document ids (empty = all) */
  docIds?: string[];
  /** Drop results below this cosine similarity */
  threshold?: number;
}

export function search(
  queryVector: number[],
  opts: SearchOptions
): ScoredChunk[] {
  const idx = load();
  const filter =
    opts.docIds && opts.docIds.length > 0 ? new Set(opts.docIds) : null;
  const threshold = opts.threshold ?? 0;

  const scored: ScoredChunk[] = [];
  for (const chunk of idx.chunks) {
    if (filter && !filter.has(chunk.docId)) continue;
    const score = cosineSimilarity(queryVector, chunk.vector);
    if (score < threshold) continue;
    scored.push({
      id: chunk.id,
      docId: chunk.docId,
      docName: chunk.docName,
      page: chunk.page,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      score,
      rerankScore: score,
    });
  }
  scored.sort((a, b) => b.rerankScore - a.rerankScore);
  return scored.slice(0, opts.topK);
}