"use client";

import {
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import type { UploadStage } from "@/lib/types";
import type { UploadState } from "@/hooks/useUpload";

/**
 * Upload progress list: status badge per file (Queued → Validating →
 * Parsing → Chunking → Embedding N% → Saving → Indexed / Failed) plus a
 * progress bar during the embedding stage.
 */

const STAGE_LABELS: Record<UploadStage, string> = {
  queued: "Queued",
  validating: "Validating",
  parsing: "Parsing",
  chunking: "Chunking",
  embedding: "Embedding",
  saving: "Saving",
  done: "Indexed",
  error: "Failed",
};

export function UploadList({
  uploads,
  onClearFinished,
}: {
  uploads: UploadState[];
  onClearFinished: () => void;
}) {
  if (uploads.length === 0) return null;

  return (
    <div className="flex-1 overflow-y-auto border-t border-zinc-200 px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Uploads
        </h3>
        <button
          onClick={onClearFinished}
          className="text-xs text-zinc-400 hover:text-zinc-600"
        >
          Clear finished
        </button>
      </div>
      <div className="space-y-2">
        {uploads.map((u, i) => (
          <div
            key={`${u.file.name}-${i}`}
            className="rounded-lg border border-zinc-200 p-3"
          >
            <div className="flex items-center gap-2.5">
              {u.stage === "done" ? (
                <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-emerald-500" />
              ) : u.stage === "error" ? (
                <XCircle className="h-4.5 w-4.5 shrink-0 text-red-500" />
              ) : (
                <Loader2 className="h-4.5 w-4.5 shrink-0 animate-spin text-brand-500" />
              )}
              <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{u.file.name}</p>
                <p className="text-[11px] text-zinc-400">
                  {formatBytes(u.file.size)}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  u.stage === "done"
                    ? "bg-emerald-100 text-emerald-700"
                    : u.stage === "error"
                      ? "bg-red-100 text-red-700"
                      : "bg-brand-100 text-brand-700"
                )}
              >
                {STAGE_LABELS[u.stage]}
                {u.stage === "embedding" && ` ${Math.round(u.progress * 100)}%`}
              </span>
            </div>

            {(u.stage === "embedding" || u.stage === "saving") && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full bg-brand-500 transition-all duration-300"
                  style={{ width: `${Math.round(u.progress * 100)}%` }}
                />
              </div>
            )}

            {u.error && (
              <p className="mt-2 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                {u.error}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}