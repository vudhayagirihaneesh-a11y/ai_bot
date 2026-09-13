"use client";

import { useCallback, useRef, useState } from "react";
import { uid } from "@/lib/utils";
import type {
  ChatMessage,
  ChatStreamEvent,
  Citation,
} from "@/lib/types";

/**
 * SSE consumer for the RAG chat endpoint.
 *
 * Handles: status stages, citations-before-generation, token streaming
 * (with micro-batching via rAF to avoid re-rendering per token), abort
 * (stop button), and error propagation.
 */

export type ChatStage =
  | "idle"
  | "searching"
  | "searching_web"
  | "generating";

interface UseChatStreamHandlers {
  onStatus: (stage: ChatStage) => void;
  onCitations: (citations: Citation[], usedContext: boolean) => void;
  /** Text chunk to append to the streaming assistant message */
  onText: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export function useChatStream(handlers: UseChatStreamHandlers) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [stage, setStage] = useState<ChatStage>("idle");
  const abortRef = useRef<AbortController | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const send = useCallback(
    async (
      message: string,
      history: { role: "user" | "assistant"; content: string }[],
      docIds?: string[]
    ) => {
      if (isStreaming) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      setStage("searching");

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, history, docIds }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          let errorMessage = `Request failed (${res.status})`;
          try {
            const json = await res.json();
            if (json.error) errorMessage = json.error;
          } catch {
            /* non-JSON error body */
          }
          throw new Error(errorMessage);
        }

        // ── Parse the SSE stream ─────────────────────────────────────────
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let pendingText = "";
        let raf: number | null = null;

        const flushText = () => {
          if (pendingText) {
            handlersRef.current.onText(pendingText);
            pendingText = "";
          }
          raf = null;
        };

        const queueText = (text: string) => {
          pendingText += text;
          if (raf == null) {
            raf = requestAnimationFrame(flushText);
          }
        };

        const finalizeStreamText = () => {
          if (raf != null) {
            cancelAnimationFrame(raf);
            raf = null;
          }
          flushText();
        };

        let streamError: string | null = null;

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
              .find((line) => line.startsWith("data: "));
            if (!dataLine) continue;

            try {
              const event = JSON.parse(
                dataLine.slice(6)
              ) as ChatStreamEvent;

              switch (event.type) {
                case "status":
                  setStage(event.stage);
                  handlersRef.current.onStatus(event.stage);
                  break;
                case "citations":
                  handlersRef.current.onCitations(
                    event.citations,
                    event.usedContext
                  );
                  break;
                case "token":
                  queueText(event.value);
                  break;
                case "done":
                  break;
                case "error":
                  streamError = event.message;
                  break;
              }
            } catch {
              /* malformed event — skip */
            }
          }
        }

        finalizeStreamText();

        if (streamError) {
          handlersRef.current.onError(streamError);
        } else {
          handlersRef.current.onDone();
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          handlersRef.current.onDone(); // user pressed stop — keep partial answer
        } else {
          handlersRef.current.onError(
            err instanceof Error ? err.message : "Network error"
          );
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
        setStage("idle");
      }
    },
    [isStreaming]
  );

  return { send, stop, isStreaming, stage };
}