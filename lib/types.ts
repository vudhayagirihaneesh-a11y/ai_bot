// ── Shared types for the RAG pipeline, API contracts and UI ──────────────────

export type ChatRole = "user" | "assistant" | "system";

/** A retrieved chunk attached to an assistant answer. */
export interface Citation {
  chunkId: string;
  docId: string;
  docName: string;
  /** "document" = knowledge base, "web" = internet fallback source */
  source?: "document" | "web";
  /** Page URL when source === "web" */
  url?: string;
  page?: number | null;
  chunkIndex?: number;
  /** Similarity score (0..1, higher = more relevant) */
  score: number;
  /** Short excerpt shown in the citation card */
  excerpt: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  citations?: Citation[];
  /** False when the answer was ungrounded (fallback path, no docs found) */
  usedContext?: boolean;
  createdAt: number;
  /** True while the assistant answer is still streaming */
  pending?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface DocumentInfo {
  id: string;
  name: string;
  size: number;
  chunks: number;
  /** Number of pages (PDF) or null for plain-text formats */
  pages: number | null;
  createdAt: number;
}

// ── SSE stream events ─────────────────────────────────────────────────────────

export type ChatStreamEvent =
  | {
      type: "status";
      stage: "searching" | "searching_web" | "generating";
    }
  | { type: "citations"; citations: Citation[]; usedContext: boolean }
  | { type: "token"; value: string }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

export type UploadStage =
  | "queued"
  | "validating"
  | "parsing"
  | "chunking"
  | "embedding"
  | "saving"
  | "done"
  | "error";

export type UploadStreamEvent =
  | { type: "stage"; stage: UploadStage; message?: string }
  | { type: "progress"; stage: "embedding" | "chunking"; progress: number }
  | { type: "done"; document: DocumentInfo }
  | { type: "error"; message: string };

// ── Internal pipeline types ───────────────────────────────────────────────────

export interface ParsedPage {
  /** 1-based page number, or null when the format has no page concept */
  page: number | null;
  text: string;
}

export interface RawChunk {
  text: string;
  page: number | null;
  chunkIndex: number;
}

export interface EmbeddedChunk extends RawChunk {
  id: string;
  docId: string;
  docName: string;
  vector: number[];
}

export interface ScoredChunk {
  id: string;
  docId: string;
  docName: string;
  page: number | null;
  chunkIndex: number;
  text: string;
  /** Raw cosine similarity */
  score: number;
  /** Combined (reranked) relevance score */
  rerankScore: number;
}