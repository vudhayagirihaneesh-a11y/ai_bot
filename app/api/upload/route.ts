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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json(
      { error: "Expected multipart/form-data with a 'file' field." },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json(
      { error: "Missing 'file' field." },
      { status: 400 }
    );
  }

  // ── Validation (extension + size) ────────────────────────────────────────
  const validation = validateFile(file);
  if (!validation.ok) {
    return Response.json(
      { error: validation.error },
      { status: 415 }
    );
  }

  // ── Magic-byte sniffing ──────────────────────────────────────────────────
  const sniff = await sniffFileType(file);
  if (!sniff.ok) {
    return Response.json({ error: sniff.error }, { status: 415 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: UploadStreamEvent) =>
        controller.enqueue(encoder.encode(sseEvent(event)));

      try {
        send({ type: "stage", stage: "validating" });

        // Persist the original file for traceability
        await fs.mkdir(uploadDir, { recursive: true });
        const storedPath = path.join(uploadDir, `${uid()}_${validation.sanitizedName}`);
        const bytes = await file.arrayBuffer();
        await fs.writeFile(storedPath, Buffer.from(bytes));

        const result = await ingestDocument({
          file: new File([bytes], validation.sanitizedName ?? file.name, {
            type: file.type,
          }),
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