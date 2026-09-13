import fs from "fs/promises";
import path from "path";
import { env } from "@/lib/env";
import type { ParsedPage } from "@/lib/types";

/**
 * Document parsers. Each returns pages (1-based page numbers for PDF,
 * null-page single page for text formats) so citations can point at
 * exact pages.
 */

const pdfjsCache: { mod?: typeof import("pdfjs-dist/legacy/build/pdf.mjs") } = {};

async function getPdfJs() {
  if (!pdfjsCache.mod) {
    pdfjsCache.mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsCache.mod;
}

export async function parsePdf(buf: Buffer): Promise<ParsedPage[]> {
  const pdfjs = await getPdfJs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const pages: ParsedPage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Join text items; keep line breaks between separate lines when possible
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .replace(/\s+([.,;:!?])/g, "$1")
      .trim();
    if (text.length > 0) pages.push({ page: p, text });
  }
  await doc.destroy();
  return pages;
}

export async function parseDocx(buf: Buffer): Promise<ParsedPage[]> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: buf });
  return [{ page: null, text: result.value }];
}

export async function parseTextFile(buf: Buffer): Promise<ParsedPage[]> {
  return [{ page: null, text: buf.toString("utf-8") }];
}

/** Dispatch based on extension. Throws on unsupported types. */
export async function parseFile(
  filePath: string,
  buf: Buffer
): Promise<ParsedPage[]> {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".pdf":
      return parsePdf(buf);
    case ".docx":
      return parseDocx(buf);
    case ".txt":
    case ".md":
      return parseTextFile(buf);
    default:
      throw new Error(`No parser for extension "${ext}"`);
  }
}

/** Read + parse a file from disk (used by the CLI ingest script). */
export async function parseFileFromDisk(
  filePath: string
): Promise<{ pages: ParsedPage[]; size: number; name: string }> {
  const buf = await fs.readFile(filePath);
  const pages = await parseFile(filePath, buf);
  return {
    pages,
    size: buf.byteLength,
    name: path.basename(filePath),
  };
}

export function isAllowedExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return env.allowedExtensions.includes(
    ext as (typeof env.allowedExtensions)[number]
  );
}