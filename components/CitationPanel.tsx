"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Globe,
  Quote,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Citation } from "@/lib/types";

/**
 * Collapsible citation panel: shows the exact document sources and chunk
 * excerpts used for an answer. Collapsed by default showing just badges.
 */

interface CitationPanelProps {
  citations: Citation[];
  /** False when the answer was NOT grounded (fallback path) */
  usedContext: boolean;
  defaultOpen?: boolean;
}

export function CitationPanel({
  citations,
  usedContext,
  defaultOpen = false,
}: CitationPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (!usedContext) {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Ungrounded answer — no relevant documents were found in the
          knowledge base.
        </span>
      </div>
    );
  }

  if (citations.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50/80">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg"
        aria-expanded={open}
      >
        <Quote className="h-3.5 w-3.5" />
        <span>
          Sources used ({citations.length})
        </span>
        <span className="ml-auto flex items-center gap-1">
          {open ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-zinc-200 p-2">
          {citations.map((c, i) => (
            <div
              key={c.chunkId}
              className="rounded-md border border-zinc-200 bg-white p-2.5 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-700">
                  {i + 1}
                </span>
                {c.source === "web" ? (
                  <Globe className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                )}
                {c.source === "web" && c.url ? (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 truncate font-medium text-sky-600 underline-offset-2 hover:underline"
                    title={c.url}
                  >
                    {c.docName}
                  </a>
                ) : (
                  <span className="truncate font-medium text-zinc-700">
                    {c.docName}
                  </span>
                )}
                {c.source === "web" && (
                  <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                    Web
                  </span>
                )}
                {c.page != null && (
                  <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">
                    page {c.page}
                  </span>
                )}
                <span
                  className={cn(
                    "ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono",
                    c.score >= 0.5
                      ? "bg-emerald-100 text-emerald-700"
                      : c.score >= 0.35
                        ? "bg-amber-100 text-amber-700"
                        : "bg-zinc-100 text-zinc-500"
                  )}
                >
                  {(c.score * 100).toFixed(0)}%
                </span>
              </div>
              <p className="mt-1.5 line-clamp-3 pl-7 leading-relaxed text-zinc-500">
                “{c.excerpt}
                {c.excerpt.length >= 220 ? "…" : ""}”
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}