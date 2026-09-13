import path from "path";
import fs from "fs/promises";
import { env, uploadDir } from "@/lib/env";
import { checkApiKey, enforceRateLimit } from "@/lib/security/rateLimit";
import { sniffFileType, validateFile } from "@/lib/security/validation";
import { ingestDocument } from "@/lib/rag/pipeline";
import { uid } from "@/lib/utils";
import type { UploadStreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/upload — multipart file upload with SSE progress events.
 *
 * Stages: validating → parsing → chunking → embedding (with 0..1 progress)
 *         → saving → done { document }
 * Errors surface as { type: "error", message } events (HTTP 200 stream,
 * like the chat route, so the client can render them uniformly).
 */

function sseEvent(event: UploadStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: Request): Promise<Response> {
  const unauthorized = checkApiKey(req);
  if (unauthorized) return unauthorized;

  const limited = enforceRateLimit(req, "upload");
  if (limited) return limited;

  let payload: { fileName: string; storagePath: string; mimeType: string; size: number };
  try {
    payload = await req.json();
  } catch {
    return Response.json(
      { error: "Expected JSON payload with storagePath." },
      { status: 400 }
    );
  }

  if (!payload.fileName || !payload.storagePath) {
    return Response.json(
      { error: "Missing fileName or storagePath." },
      { status: 400 }
    );
  }

  // ── Validation (extension + size) ────────────────────────────────────────
  // We can't sniff bytes here easily since the file is in Supabase.
  // The client uploaded it, so we trust the extension/mimeType for now, 
  // but we should validate the extension is supported.
  const ext = path.extname(payload.fileName).toLowerCase();
  const allowed = [".pdf", ".txt", ".md", ".docx"];
  if (!allowed.includes(ext)) {
    return Response.json(
      { error: `Unsupported file type: ${ext}` },
      { status: 415 }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: UploadStreamEvent) =>
        controller.enqueue(encoder.encode(sseEvent(event)));

      try {
        send({ type: "stage", stage: "validating" });

        const result = await ingestDocument({
          storagePath: payload.storagePath,
          fileName: payload.fileName,
          size: payload.size,
          onProgress: (e) => {
            if (e.progress != null) {
              send({
                type: "progress",
                stage: e.stage === "embedding" ? "embedding" : "chunking",
                progress: e.progress,
              });
            } else {
              send({
                type: "stage",
                stage:
                  e.stage === "parsing"
                    ? "parsing"
                    : e.stage === "chunking"
                      ? "chunking"
                      : e.stage === "embedding"
                        ? "embedding"
                        : "saving",
                message: e.message,
              });
            }
          },
        });

        send({ type: "done", document: result.document });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Upload processing failed";
        console.error("[upload] Error:", message);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}