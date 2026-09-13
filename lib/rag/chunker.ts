import { env } from "@/lib/env";
import type { ParsedPage, RawChunk } from "@/lib/types";

/**
 * RecursiveCharacterTextSplitter-style chunker.
 *
 * Splits text hierarchically with markdown/paragraph-aware separators,
 * merging small pieces up to `sizeChars` and keeping `overlapChars`
 * between consecutive chunks (~4 chars per token => 2400 chars ≈ 600
 * tokens, overlap 15%).
 */

const SEPARATORS = ["\n\n", "\n", ". ", "; ", " ", ""] as const;

function splitWithSeparators(
  text: string,
  sepIdx: number
): string[] {
  const sep = SEPARATORS[sepIdx];
  if (sep === "") return Array.from(text);
  return text.split(sep).filter((s) => s.length > 0);
}

function splitText(text: string): string[] {
  const size = env.chunk.sizeChars;
  const overlap = env.chunk.overlapChars;

  if (text.length <= size) return [text.trim()].filter((s) => s.length > 0);

  const pieces: string[] = [];

  function recurse(current: string, sepIdx: number): void {
    if (current.length <= size) {
      pieces.push(current);
      return;
    }
    // Try finer separators until one yields splits that fit
    let idx = sepIdx;
    let parts = splitWithSeparators(current, idx);
    while (
      idx < SEPARATORS.length - 1 &&
      (parts.length < 2 ||
        parts.every((p) => p.length > size))
    ) {
      idx++;
      parts = splitWithSeparators(current, idx);
    }

    // Merge parts into windowed chunks with overlap
    const window = env.chunk.sizeChars;
    let buffer = "";
    let started = false;
    for (const part of parts) {
      const candidate = started ? `${SEPARATORS[idx] === "" ? "" : SEPARATORS[idx]}${buffer}${part}` : part;
      if (candidate.length <= window) {
        buffer = started ? candidate : part;
        started = true;
      } else {
        if (buffer.length > 0) pieces.push(buffer);
        // Keep the tail as overlap for the next chunk
        const overlapText =
          env.chunk.overlapChars > 0 && buffer.length > env.chunk.overlapChars
            ? buffer.slice(-env.chunk.overlapChars)
            : buffer.length <= env.chunk.overlapChars
              ? buffer
              : "";
        buffer = overlapText ? `${overlapText} ${part}` : part;
        if (buffer.length > window * 2) {
          // Very long single part: hard-split
          for (let i = 0; i < buffer.length; i += window) {
            pieces.push(buffer.slice(i, i + window));
          }
          buffer = "";
          started = false;
        }
      }
    }
    if (buffer.length > 0) pieces.push(buffer);
  }

  recurse(text, 0);
  return pieces.map((p) => p.trim()).filter((p) => p.length > 20);
}

/** Split pages into overlapping chunks with page metadata. */
export function chunkPages(pages: ParsedPage[]): RawChunk[] {
  const rawChunks: RawChunk[] = [];
  for (const page of pages) {
    const pieces = splitText(page.text);
    // Index continues across pages for stable ordering
    pieces.forEach((text, i) => {
      rawChunks.push({
        text,
        page: page.page,
        chunkIndex: rawChunks.length + i,
      });
    });
  }
  // Re-index sequentially
  rawChunks.forEach((c, i) => (c.chunkIndex = i));
  return rawChunks;
}