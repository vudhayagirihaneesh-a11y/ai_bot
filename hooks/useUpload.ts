"use client";

import { useCallback, useRef, useState } from "react";
import type {
  DocumentInfo,
  UploadStage,
  UploadStreamEvent,
} from "@/lib/types";

/**
 * SSE consumer for the /api/upload endpoint.
 * Tracks per-stage progress (embedding 0..1) for progress indicators.
 */

export interface UploadState {
  file: File;
  stage: UploadStage;
  /** 0..1 progress within the embedding stage */
  progress: number;
  message?: string;
  error?: string;
  result?: DocumentInfo;
}

export function useUpload(onFinished?: (doc: DocumentInfo) => void) {
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  const patchUpload = useCallback(
    (file: File, patch: Partial<UploadState>) => {
      setUploads((prev) =>
        prev.map((u) => (u.file === file ? { ...u, ...patch } : u))
      );
    },
    []
  );

  const upload = useCallback(
    async (file: File): Promise<DocumentInfo | null> => {
      setUploads((prev) => [
        ...prev,
        { file, stage: "queued", progress: 0 },
      ]);
      setIsUploading(true);

      const body = new FormData();
      body.append("file", file);

      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          body,
        });

        // Non-2xx JSON error (validation, rate limit, auth)
        if (!res.ok || !res.body) {
          let message = `Upload failed (${res.status})`;
          try {
            const json = await res.json();
            if (json.error) message = json.error;
          } catch {
            /* ignore */
          }
          patchUpload(file, { stage: "error", error: message });
          return null;
        }

        // Parse the SSE stream
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let result: DocumentInfo | null = null;
        let error: string | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sepIdx = buffer.indexOf("\n\n");
          while (sepIdx !== -1) {
            const rawEvent = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);
            sepIdx = buffer.indexOf("\n\n");

            const dataLine = rawEvent
              .split("\n")
              .find((l) => l.startsWith("data: "));
            if (!dataLine) continue;

            try {
              const event = JSON.parse(
                dataLine.slice(6)
              ) as UploadStreamEvent;

              if (event.type === "stage") {
                patchUpload(file, {
                  stage: event.stage,
                  message: event.message,
                });
              } else if (event.type === "progress") {
                patchUpload(file, {
                  stage: event.stage === "embedding" ? "embedding" : "chunking",
                  progress: event.progress,
                });
              } else if (event.type === "done") {
                result = event.document;
                patchUpload(file, {
                  stage: "done",
                  progress: 1,
                  result: event.document,
                });
                finishedRef.current?.(event.document);
              } else if (event.type === "error") {
                error = event.message;
                patchUpload(file, { stage: "error", error: event.message });
              }
            } catch {
              /* malformed event — skip */
            }
          }
        }

        return error ? null : result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Network error during upload";
        patchUpload(file, { stage: "error", error: message });
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [patchUpload]
  );

  /** Remove an upload entry (dismiss from the list). */
  const dismissUpload = useCallback((file: File) => {
    setUploads((prev) => prev.filter((u) => u.file !== file));
  }, []);

  /** Clear completed/failed entries. */
  const clearFinished = useCallback(() => {
    setUploads((prev) =>
      prev.filter((u) => u.stage !== "done" && u.stage !== "error")
    );
  }, []);

  return {
    uploads,
    isUploading,
    upload,
    dismissUpload,
    clearFinished,
  };
}