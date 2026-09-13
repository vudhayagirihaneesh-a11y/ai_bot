"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Menu, Send, Square, Bot, Database, Globe, BookOpen } from "lucide-react";
import { uid } from "@/lib/utils";
import type { Citation, DocumentInfo } from "@/lib/types";
import { useConversations } from "@/hooks/useConversations";
import { useChatStream, type ChatStage } from "@/hooks/useChatStream";
import { ChatBubble } from "@/components/ChatBubble";
import { Sidebar } from "@/components/Sidebar";
import { EmptyState } from "@/components/EmptyState";

/**
 * Chat surface: message list with streaming assistant answers, stop
 * control, example prompts on empty state, and the sidebar with
 * conversation history + knowledge base management.
 */
export default function ChatPage() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [input, setInput] = useState("");
  const [stage, setStage] = useState<ChatStage>("idle");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    conversations,
    activeConversation,
    activeId,
    setActiveId,
    createConversation,
    deleteConversation,
    appendMessage,
    updateMessage,
    appendToMessage,
  } = useConversations();

  const convIdRef = useRef<string | null>(null);
  convIdRef.current = activeConversation?.id ?? null;
  const assistantMsgIdRef = useRef<string | null>(null);

  // ── Document list (knowledge base) ──────────────────────────────────────
  const refreshDocuments = useCallback(async () => {
    try {
      const res = await fetch("/api/documents");
      if (res.ok) {
        const json = (await res.json()) as { documents: DocumentInfo[] };
        setDocuments(json.documents);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  // ── Ensure conversation + pending assistant message exist ───────────────
  const ensureTargets = useCallback(() => {
    let convId = convIdRef.current;
    if (!convId) {
      const conv = createConversation();
      convId = conv.id;
    }
    let msgId = assistantMsgIdRef.current;
    if (!msgId) {
      msgId = uid();
      appendMessage(convId, {
        id: msgId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        pending: true,
      });
      assistantMsgIdRef.current = msgId;
    }
    return { convId, msgId };
  }, [createConversation, appendMessage]);

  // ── Stream handlers ─────────────────────────────────────────────────────
  const stream = useChatStream({
    onStatus: (s) => setStage(s),
    onCitations: (citations: Citation[], usedContext: boolean) => {
      const { convId, msgId } = ensureTargets();
      updateMessage(convId, msgId, { citations, usedContext });
    },
    onText: (text: string) => {
      const { convId, msgId } = ensureTargets();
      appendToMessage(convId, msgId, text);
    },
    onDone: () => {
      setStage("idle");
      const convId = convIdRef.current;
      const msgId = assistantMsgIdRef.current;
      if (convId && msgId) updateMessage(convId, msgId, { pending: false });
      assistantMsgIdRef.current = null;
    },
    onError: (message: string) => {
      setStage("idle");
      const convId = convIdRef.current;
      const msgId = assistantMsgIdRef.current;
      if (convId && msgId) {
        updateMessage(convId, msgId, {
          pending: false,
          content:
            `⚠️ ${message}\n\n` +
            "Check that Ollama is running (`ollama serve`) and models are pulled (`ollama list`).",
        });
      }
      assistantMsgIdRef.current = null;
    },
  });

  // ── Send ────────────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || stream.isStreaming) return;

      let convId = convIdRef.current;
      if (!convId) {
        const conv = createConversation();
        convId = conv.id;
      }

      // History BEFORE appending the new user message
      const history = (activeConversation?.messages ?? [])
        .filter((m) => !m.pending)
        .slice(-8)
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      appendMessage(convId, {
        id: uid(),
        role: "user",
        content: question,
        createdAt: Date.now(),
      });

      assistantMsgIdRef.current = null;
      setInput("");

      await stream.send(question, history);
    },
    [activeConversation, createConversation, appendMessage, stream]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // Auto-scroll to the newest message
  const lastContent =
    activeConversation?.messages[activeConversation.messages.length - 1]
      ?.content;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConversation?.messages.length, lastContent]);

  const messages = activeConversation?.messages ?? [];
  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-zinc-900/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar: overlay on mobile, static on desktop */}
      <div
        className={
          sidebarOpen
            ? "fixed inset-y-0 left-0 z-40 lg:static lg:z-auto"
            : "hidden"
        }
      >
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          conversations={conversations}
          activeId={activeId}
          onSelect={(id) => {
            setActiveId(id);
            assistantMsgIdRef.current = null;
            if (window.innerWidth < 1024) setSidebarOpen(false);
          }}
          onNew={() => {
            createConversation();
            if (window.innerWidth < 1024) setSidebarOpen(false);
          }}
          onDelete={deleteConversation}
          onDocumentAdded={() => void refreshDocuments()}
          onDocumentDeleted={() => void refreshDocuments()}
          documents={documents}
        />
      </div>

      {/* Main column */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3">
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100"
            aria-label="Toggle sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-brand-600" />
            <h1 className="text-sm font-semibold">
              Maths AI — Local Knowledge Assistant
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-[11px] text-zinc-500">
            <Database className="h-3 w-3" />
            {documents.length} docs ·{" "}
            {documents.reduce((sum, d) => sum + d.chunks, 0)} chunks
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-3xl space-y-4">
            {isEmpty ? (
              <EmptyState onPick={(p) => void sendMessage(p)} />
            ) : (
              messages.map((message) => (
                <ChatBubble key={message.id} message={message} />
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-zinc-200 bg-white px-4 py-4">
          {stream.isStreaming && stage !== "idle" && (
            <div className="mx-auto mb-2 flex max-w-3xl items-center justify-center">
              <div
                className={
                  stage === "searching_web"
                    ? "flex items-center gap-1.5 rounded-full bg-sky-100 px-3 py-1 text-[11px] font-medium text-sky-700"
                    : "flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-[11px] text-zinc-500"
                }
              >
                {stage === "searching" && (
                  <>
                    <BookOpen className="h-3 w-3" />
                    Searching the knowledge base…
                  </>
                )}
                {stage === "searching_web" && (
                  <>
                    <Globe className="h-3 w-3 animate-pulse" />
                    Not in the knowledge base — searching the web (restricted)…
                  </>
                )}
                {stage === "generating" && <>Generating answer…</>}
              </div>
            </div>
          )}
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your documents…"
              rows={1}
              className="max-h-[200px] flex-1 resize-none rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            {stream.isStreaming ? (
              <button
                onClick={stream.stop}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-white hover:bg-zinc-700"
                aria-label="Stop generating"
              >
                <Square className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={() => void sendMessage(input)}
                disabled={!input.trim()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-zinc-400">
            Answers are grounded in your documents and include citations.
            Enter to send · Shift+Enter for a new line.
          </p>
        </div>
      </main>
    </div>
  );
}