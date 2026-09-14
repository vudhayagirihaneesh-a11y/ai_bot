"use client";

import { Sparkles } from "lucide-react";

const EXAMPLE_PROMPTS = [
  "Summarize the key points from my documents",
  "What interview questions should I ask a full-stack candidate?",
  "How should the bot handle a candidate who says \u201cI don't know\u201d?",
  "What are the edge cases the bot must handle?",
];

export function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 dark:bg-brand-900/30">
        <Sparkles className="h-7 w-7 text-brand-600 dark:text-brand-300" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        Ask Maths AI anything
      </h2>
      <p className="mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
        I can answer your questions based on the mathematics knowledge base.
      </p>
    </div>
  );
}