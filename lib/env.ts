import path from "path";

/**
 * Central runtime configuration. All values have sane local defaults so the
 * app works out of the box; override via .env (see .env.example).
 */
function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** True when running in production or inside a Vercel serverless function. */
export const isVercel = process.env.NODE_ENV === "production" || !!process.env.VERCEL;

export const env = {
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    chatModel: process.env.OLLAMA_CHAT_MODEL || "llama3.2:3b",
    embedModel: process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text",
  },
  store: {
    // On Vercel the project root is read-only — only /tmp is writable.
    vectorPath:
      process.env.VECTOR_STORE_PATH ||
      (isVercel ? "/tmp/vector_index.json" : "./data/vector_index.json"),
    uploadDir:
      process.env.UPLOAD_DIR ||
      (isVercel ? "/tmp/uploads" : "./data/uploads"),
  },
  chunk: {
    sizeChars: int(process.env.CHUNK_SIZE_CHARS, 2400),
    overlapChars: int(process.env.CHUNK_OVERLAP_CHARS, 360),
  },
  retrieval: {
    topK: int(process.env.TOP_K, 5),
    threshold: num(process.env.RELEVANCE_THRESHOLD, 0.3),
    historyWindow: int(process.env.HISTORY_WINDOW, 8),
    /** Candidate pool fetched before reranking */
    candidates: int(process.env.TOP_K, 5) * 3,
  },
  upload: {
    maxUploadMb: int(process.env.MAX_UPLOAD_MB, 25),
  },
  rate: {
    chatRequests: int(process.env.RATE_LIMIT_CHAT_REQUESTS, 30),
    uploadRequests: int(process.env.RATE_LIMIT_UPLOAD_REQUESTS, 10),
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  },
  security: {
    apiKey: process.env.API_KEY || "",
  },
  supabase: {
    url: process.env.SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
  },
  /**
   * Restricted web-search fallback: consulted ONLY when the knowledge
   * base has no relevant chunks. Disable with WEB_SEARCH_ENABLED=false.
   */
  web: {
    enabled: (process.env.WEB_SEARCH_ENABLED || "true") === "true",
    maxResults: int(process.env.WEB_MAX_RESULTS, 4),
    pageMaxChars: int(process.env.WEB_PAGE_MAX_CHARS, 4000),
    timeoutMs: int(process.env.WEB_TIMEOUT_MS, 10_000),
    /**
     * When the best knowledge-base score is BELOW this value the answer
     * is considered unreliable and the restricted web fallback runs
     * first. Embedding models have a high similarity baseline for any
     * English text (~0.4), so 0.55 means "genuinely about the topic".
     */
    fallbackScore: num(process.env.WEB_FALLBACK_SCORE, 0.55),
  },
  /** Allowed file extensions for upload */
  allowedExtensions: [".pdf", ".docx", ".txt", ".md"] as const,
} as const;

export const maxUploadBytes = env.upload.maxUploadMb * 1024 * 1024;

export const vectorPath = path.resolve(env.store.vectorPath);
export const uploadDir = path.resolve(env.store.uploadDir);