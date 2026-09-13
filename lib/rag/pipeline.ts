import fs from "fs/promises";
import path from "path";
import { uid } from "@/lib/utils";
import { env, uploadDir } from "@/lib/env";
import { embedTexts, embeddingDimension } from "@/lib/ai/ollama";
import { parseFile } from "@/lib/rag/parsers";
import { chunkPages } from "@/lib/rag/chunker";
import {
  addDocument,
  clearIndex,
  indexStats,
  listDocuments,
  persistNow,
  removeDocument,
} from "@/lib/store/vectorStore";
import type {
  DocumentInfo,
  EmbeddedChunk,
} from "@/lib/types";

/**
 * Ingestion pipeline: parse → chunk → embed (batch) → upsert into the
 * vector store. Shared by the /api/upload endpoint and the CLI script.
 */

export interface IngestResult {
  document: DocumentInfo;
}

export interface IngestInput {
  /** Uploaded file object (web) */
  file?: File;
  /** Or a file already saved on disk (CLI) */
  filePath?: string;
  docId?: string;
  onProgress?: (e: {
    stage: "parsing" | "chunking" | "embedding" | "saving";
    progress?: number;
    message?: string;
  }) => void;
}

export async function ingestDocument(
  input: IngestInput
): Promise<IngestResult> {
  const onProgress = input.onProgress ?? (() => {});

  // ── 1. Obtain bytes + name ──────────────────────────────────────────────
  let buf: Buffer;
  let name: string;
  let size: number;
  let storedPath: string | null = null;

  if (input.file) {
    buf = Buffer.from(await input.file.arrayBuffer());
    name = input.file.name;
    size = input.file.size;
  } else if (input.filePath) {
    buf = await fs.readFile(input.filePath);
    name = path.basename(input.filePath);
    size = buf.byteLength;
  } else {
    throw new Error("Either file or filePath is required");
  }

  // Upload to Supabase Storage
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(env.supabase.url, env.supabase.anonKey);
  const sanitized = name.replace(/[^\w.\-() ]+/g, "_");
  const storagePath = `${uid()}_${sanitized}`;
  
  onProgress({ stage: "parsing", message: `Uploading ${name}` });
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, buf, { contentType: input.file?.type || "application/octet-stream" });
    
  if (uploadError) {
    throw new Error("Failed to upload to Supabase: " + uploadError.message);
  }

  // ── 2. Parse ────────────────────────────────────────────────────────────
  onProgress({ stage: "parsing", message: `Parsing ${name}` });
  const pages = await parseFile(name, buf);
  const pageCount = pages.length > 1 || pages[0]?.page != null
    ? pages.filter((p) => p.page != null).length || null
    : null;

  // ── 3. Chunk ────────────────────────────────────────────────────────────
  onProgress({ stage: "chunking", message: "Splitting into chunks" });
  const rawChunks = chunkPages(pages);
  if (rawChunks.length === 0) {
    throw new Error(
      "No text could be extracted from this document (scanned PDF without OCR layer?)."
    );
  }

  // ── 4. Embed in batches with progress ───────────────────────────────────
  onProgress({
    stage: "embedding",
    progress: 0,
    message: `Embedding ${rawChunks.length} chunks`,
  });

  const docId = input.docId ?? uid();
  const docName = name;
  const batchSize = 16;
  const embedded: EmbeddedChunk[] = [];

  for (let i = 0; i < rawChunks.length; i += batchSize) {
    const batch = rawChunks.slice(i, i + batchSize);
    const vectors = await embedTexts(batch.map((c) => c.text));
    batch.forEach((chunk, j) => {
      embedded.push({
        ...chunk,
        id: `${docId}:${chunk.chunkIndex}`,
        docId,
        docName,
        vector: vectors[j],
      });
    });
    onProgress({
      stage: "embedding",
      progress: Math.min(1, (i + batchSize) / rawChunks.length),
    });
  }

  const dimension = embedded[0].vector.length;

  // ── 5. Upsert into the vector store ─────────────────────────────────────
  onProgress({ stage: "saving", message: "Updating vector index" });
  const doc: DocumentInfo = {
    id: docId,
    name: docName,
    size,
    chunks: embedded.length,
    pages: pageCount,
    createdAt: Date.now(),
  };
  await addDocument(doc, embedded, dimension);

  onProgress({ stage: "saving", progress: 1, message: "Done" });
  return { document: { ...doc, chunks: embedded.length } };
}

export async function deleteDocument(docId: string): Promise<boolean> {
  const docs = await listDocuments();
  const doc = docs.find((d) => d.id === docId);
  if (!doc) return false;
  
  const ok = await removeDocument(docId);
  if (ok) {
    // Delete all files in storage bucket that contain the sanitized name
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(env.supabase.url, env.supabase.anonKey);
    const sanitized = doc.name.replace(/[^\w.\-() ]+/g, "_");
    
    const { data: files } = await supabase.storage.from("documents").list();
    if (files) {
      const filesToDelete = files.filter(f => f.name.endsWith(`_${sanitized}`)).map(f => f.name);
      if (filesToDelete.length > 0) {
        await supabase.storage.from("documents").remove(filesToDelete);
      }
    }
  }
  return ok;
}

export async function resetKnowledgeBase(): Promise<void> {
  await clearIndex();
  
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(env.supabase.url, env.supabase.anonKey);
  
  const { data: files } = await supabase.storage.from("documents").list();
  if (files && files.length > 0) {
    await supabase.storage.from("documents").remove(files.map(f => f.name));
  }
}

export { indexStats, embeddingDimension };