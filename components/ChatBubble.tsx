"use client";

import { memo } from "react";
import { Bot, User } from "lucide-react";
import { cn, formatTime } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";
import { MarkdownContent } from "@/components/MarkdownContent";
import { CitationPanel } from "@/components/CitationPanel";

/**
 * Chat message bubble: user (right, brand) vs assistant (left, white) with
 * markdown rendering, streaming caret while pending, and the collapsible
 * citation panel under assistant answers.
 */
function ChatBubbleImpl({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex w-full gap-3",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
          <Bot className="h-4.5 w-4.5" />
        </div>
      )}

      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3 shadow-sm sm:max-w-[75%]",
          isUser
            ? "rounded-br-md bg-brand-600 text-white"
            : "rounded-bl-md border border-zinc-200 bg-white"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {message.content}
          </p>
        ) : (
          <div
            className={cn(
              message.pending && message.content
                ? "streaming-caret"
                : undefined
            )}
          >
            {message.content ? (
              <MarkdownContent content={message.content} />
            ) : message.pending ? (
              <p className="text-sm text-zinc-400 streaming-caret">
                {message.citations && message.citations.length > 0
                  ? "Found relevant sources. Generating answer…"
                  : "Searching the knowledge base…"}
              </p>
            ) : null}

            {!message.pending && message.citations && (
              <CitationPanel
                citations={message.citations}
                usedContext={message.usedContext ?? message.citations.length > 0}
              />
            )}
          </div>
        )}

        <p
          className={cn(
            "mt-1.5 text-[10px]",
            isUser ? "text-brand-200" : "text-zinc-400"
          )}
        >
          {formatTime(message.createdAt)}
        </p>
      </div>

      {isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-600">
          <User className="h-4.5 w-4.5" />
        </div>
      )}
    </div>
  );
}

export const ChatBubble = memo(ChatBubbleImpl);