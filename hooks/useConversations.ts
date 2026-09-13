"use client";

import { useCallback, useEffect, useState } from "react";
import { uid } from "@/lib/utils";
import type { Conversation, ChatMessage } from "@/lib/types";

/**
 * Conversation history persistence (localStorage).
 * Conversations auto-save on change; the hook exposes CRUD helpers used
 * by the sidebar and chat surface.
 */

const STORAGE_KEY = "maths_ai_conversations_v1";

function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Conversation[];
    // Strip any stuck "pending" flags from a previous session
    for (const conv of parsed) {
      for (const msg of conv.messages) msg.pending = false;
    }
    return parsed.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const convs = loadConversations();
    setConversations(convs);
    setActiveId(convs[0]?.id ?? null);
    setHydrated(true);
  }, []);

  // Persist on every change (after hydration)
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(conversations.slice(0, 100))
      );
    } catch {
      // Quota exceeded: drop oldest conversations and retry once
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(conversations.slice(0, 20))
        );
      } catch {
        /* give up silently */
      }
    }
  }, [conversations]);

  const createConversation = useCallback((): Conversation => {
    const now = Date.now();
    const conv: Conversation = {
      id: uid(),
      title: "New chat",
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    return conv;
  }, []);

  const updateConversation = useCallback(
    (id: string, updater: (conv: Conversation) => Conversation) => {
      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === id ? { ...updater(conv), updatedAt: Date.now() } : conv
        )
      );
    },
    []
  );

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      setActiveId((current) =>
        current === id ? (next[0]?.id ?? null) : current
      );
      return next;
    });
  }, []);

  const renameConversation = useCallback(
    (id: string, title: string) => {
      updateConversation(id, (conv) => ({ ...conv, title }));
    },
    [updateConversation]
  );

  const appendMessage = useCallback(
    (convId: string, message: ChatMessage) => {
      updateConversation(convId, (conv) => {
        const messages = [...conv.messages, message];
        const title =
          conv.messages.length === 0 && message.role === "user"
            ? message.content.slice(0, 60) || "New chat"
            : conv.title;
        return { ...conv, messages, title };
      });
    },
    [updateConversation]
  );

  const updateMessage = useCallback(
    (convId: string, msgId: string, patch: Partial<ChatMessage>) => {
      updateConversation(convId, (conv) => ({
        ...conv,
        messages: conv.messages.map((m) =>
          m.id === msgId ? { ...m, ...patch } : m
        ),
      }));
    },
    [updateConversation]
  );

  /** Streamed-token batching: append text to a pending assistant message. */
  const appendToMessage = useCallback(
    (convId: string, msgId: string, text: string) => {
      updateConversation(convId, (conv) => ({
        ...conv,
        messages: conv.messages.map((m) =>
          m.id === msgId ? { ...m, content: m.content + text } : m
        ),
      }));
    },
    [updateConversation]
  );

  const activeConversation =
    conversations.find((c) => c.id === activeId) ?? null;

  return {
    conversations,
    activeConversation,
    activeId,
    setActiveId,
    hydrated,
    createConversation,
    deleteConversation,
    renameConversation,
    appendMessage,
    updateMessage,
    appendToMessage,
  };
}