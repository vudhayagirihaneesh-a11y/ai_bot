"use client";

import { useCallback, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocumentInfo } from "@/lib/types";
import { useUpload } from "@/hooks/useUpload";
import { UploadList } from "@/components/UploadList";

/**
 * Admin / Knowledge Base upload modal.
 * Drag-and-drop + file picker; per-file status badges and embedding
 * progress bars live in UploadList (SSE-driven).
 */

const ALLOWED = [".pdf", ".docx", ".txt", ".md"];
const ACCEPT = ALLOWED.join(",");

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  onDocumentAdded: (doc: DocumentInfo) => void;
}

export function UploadModal({ open, onClose, onDocumentAdded }: UploadModalProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploads, upload, isUploading, clearFinished } = useUpload(onDocumentAdded);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      for (const file of Array.from(files)) {
        void upload(file);
      }
    },
    [upload]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white dark:bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Knowledge Base</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Upload documents (PDF, DOCX, TXT, MD) — max 25 MB each
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-600"
          >
            Close
          </button>
        </div>

        {/* Drop zone */}
        <div className="p-5">
          <div
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
              dragOver
                ? "border-brand-500 bg-brand-50 dark:bg-brand-900/30"
                : "border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 hover:border-brand-400 dark:hover:border-brand-600"
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
            }}
          >
            <UploadCloud className="h-10 w-10 text-brand-500" />
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Drag & drop files here, or{" "}
              <span className="text-brand-600 dark:text-brand-400 underline">browse</span>
            </p>
            <p className="text-xs text-zinc-400">{ALLOWED.join(" · ")}</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        <UploadList uploads={uploads} onClearFinished={clearFinished} />

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-200 dark:border-zinc-800 px-5 py-3.5">
          <p className="text-[11px] text-zinc-400">
            {isUploading
              ? "Processing… documents are embedded locally via Ollama."
              : "Documents are embedded locally via Ollama."}
          </p>
          <button
            onClick={onClose}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}