import path from "path";
import { env, maxUploadBytes } from "@/lib/env";

/** File validation: extension whitelist, size cap, magic-byte sniffing. */

export interface FileValidation {
  ok: boolean;
  error?: string;
  ext?: string;
  sanitizedName?: string;
}

export function sanitizeFileName(name: string): string {
  const base = path.basename(name);
  return base.replace(/[^\w.\-() ]+/g, "_").slice(0, 180) || "unnamed";
}

export function validateFile(file: File): FileValidation {
  const sanitizedName = sanitizeFileName(file.name);
  const ext = path.extname(sanitizedName).toLowerCase();

  if (!env.allowedExtensions.includes(
    ext as (typeof env.allowedExtensions)[number]
  )) {
    return {
      ok: false,
      error: `Unsupported file type "${ext || file.name}". Allowed: ${env.allowedExtensions.join(", ")}`,
    };
  }

  if (file.size === 0) {
    return { ok: false, error: "File is empty.", sanitizedName };
  }

  if (file.size > maxUploadBytes) {
    return {
      ok: false,
      error: `File exceeds the ${env.upload.maxUploadMb} MB limit.`,
      sanitizedName,
    };
  }

  return { ok: true, ext, sanitizedName };
}

/** Magic-byte sniffing so renamed executables don't sneak past the extension check. */
export async function sniffFileType(
  file: File
): Promise<{ ok: boolean; error?: string }> {
  const ext = path.extname(file.name).toLowerCase();
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());

  if (ext === ".pdf") {
    const sig = [0x25, 0x50, 0x44, 0x46]; // %PDF
    if (!sig.every((b, i) => head[i] === b)) {
      return { ok: false, error: "File claims to be a PDF but has an invalid signature." };
    }
    return { ok: true };
  }

  if (ext === ".docx") {
    const zipSig = [0x50, 0x4b]; // PK (zip container)
    if (!zipSig.every((b, i) => head[i] === b)) {
      return { ok: false, error: "File claims to be a DOCX but has an invalid signature." };
    }
    return { ok: true };
  }

  // .txt / .md must be decodable UTF-8 text
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head);
    return { ok: true };
  } catch {
    return { ok: false, error: "File is not valid UTF-8 text." };
  }
}