"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  MessageSquare,
  Trash2,
  BookOpen,
  Upload,
  FileText,
  Activity,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Conversation, DocumentInfo } from "@/lib/types";
import { UploadModal } from "@/components/UploadModal";

/**
 * Sidebar: conversation history (localStorage), knowledge-base document
 * list with chunk counts, Ollama health indicator, upload modal trigger.
 */

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onDocumentAdded: (doc: DocumentInfo) => void;
  onDocumentDeleted: (docId: string) => void;
  documents: DocumentInfo[];
}

interface Health {
  ollama: {
    alive: boolean;
    chatModelReady: boolean;
    embedModelReady: boolean;
    chatModel: string;
  };
  index: { documents: number; chunks: number };
}

export function Sidebar(props: SidebarProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);

  // Poll health every 30s (re-poll when the document list changes)
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/health");
        if (res.ok && !cancelled) setHealth(await res.json());
      } catch {
        /* offline */
      }
    };
    void poll();
    const timer = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [props.documents.length]);

  if (!props.open) return null;

  const healthy =
    health?.ollama.alive === true &&
    health?.ollama.chatModelReady === true &&
    health?.ollama.embedModelReady === true;

  const deleteDocument = async (docId: string) => {
    try {
      const res = await fetch(
        `/api/documents?id=${encodeURIComponent(docId)}`,
        { method: "DELETE" }
      );
      if (res.ok) props.onDocumentDeleted(docId);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <aside className="flex h-full w-72 flex-col border-r border-zinc-200 bg-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3.5">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4.5 w-4.5 text-brand-600" />
            <span className="text-sm font-semibold">Maths AI</span>
          </div>
          <button
            onClick={props.onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 lg:hidden"
            aria-label="Close sidebar"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        {/* New chat + health */}
        <div className="px-3 pt-3">
          <button
            onClick={props.onNew}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" />
            New chat
          </button>
          <div
            className={cn(
              "mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px]",
              health == null
                ? "border-zinc-200 bg-zinc-50 text-zinc-500"
                : healthy
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
            )}
          >
            <Activity className="h-3.5 w-3.5 shrink-0" />
            {health == null ? (
              <span>Checking Ollama…</span>
            ) : healthy ? (
              <span className="truncate">
                Ollama ready · {health.ollama.chatModel}
              </span>
            ) : (
              <span className="truncate">
                {!health.ollama.alive
                  ? "Ollama offline — check server connection"
                  : !health.ollama.chatModelReady
                    ? "Chat model missing"
                    : "Embed model missing"}
              </span>
            )}
          </div>
        </div>

        <ConversationList
          conversations={props.conversations}
          activeId={props.activeId}
          onSelect={props.onSelect}
          onDelete={props.onDelete}
        />

        <KnowledgeBaseSection
          documents={props.documents}
          onUploadClick={() => setUploadOpen(true)}
          onDeleteDocument={deleteDocument}
        />
      </aside>

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onDocumentAdded={props.onDocumentAdded}
      />
    </>
  );
}

function ConversationList({
  conversations,
  activeId,
  onSelect,
  onDelete,
}: Pick<SidebarProps, "conversations" | "activeId" | "onSelect" | "onDelete">) {
  return (
    <div className="mt-4 flex-1 overflow-y-auto px-3">
      <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        History
      </p>
      {conversations.length === 0 ? (
        <p className="px-1 text-xs text-zinc-400">No conversations yet.</p>
      ) : (
        <div className="space-y-1">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={cn(
                "group flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
                conv.id === activeId
                  ? "bg-brand-50 text-brand-800"
                  : "text-zinc-600 hover:bg-zinc-100"
              )}
            >
              <button
                onClick={() => onSelect(conv.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <span className="truncate">{conv.title}</span>
              </button>
              <button
                onClick={() => onDelete(conv.id)}
                className="shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-zinc-200 group-hover:opacity-100"
                aria-label="Delete conversation"
              >
                <Trash2 className="h-3.5 w-3.5 text-zinc-400" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KnowledgeBaseSection({
  documents,
  onUploadClick,
  onDeleteDocument,
}: {
  documents: DocumentInfo[];
  onUploadClick: () => void;
  onDeleteDocument: (docId: string) => void;
}) {
  return (
    <div className="border-t border-zinc-200 px-3 py-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Knowledge Base
        </p>
        <button
          onClick={onUploadClick}
          className="flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100"
        >
          <Upload className="h-3 w-3" />
          Upload
        </button>
      </div>

      {documents.length === 0 ? (
        <p className="px-1 text-xs text-zinc-400">
          No documents yet. Use Upload or run{" "}
          <code className="font-mono">npm run ingest</code>.
        </p>
      ) : (
        <div className="max-h-40 space-y-1 overflow-y-auto">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              <span className="min-w-0 flex-1 truncate">{doc.name}</span>
              <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">
                {doc.chunks}
              </span>
              <button
                onClick={() => onDeleteDocument(doc.id)}
                className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-zinc-200 group-hover:opacity-100"
                aria-label="Delete document"
              >
                <Trash2 className="h-3 w-3 text-zinc-400" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}