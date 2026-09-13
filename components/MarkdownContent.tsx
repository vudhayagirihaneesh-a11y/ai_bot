"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";

/**
 * Streaming-safe markdown renderer.
 *
 * memo() avoids re-parsing untouched messages when a new token arrives in
 * the active message. remark-gfm enables tables/strikethrough; rehype-
 * highlight adds syntax highlighting to fenced code blocks (theme in
 * globals.css). During streaming, incomplete markdown (e.g. an open code
 * fence) renders progressively — react-markdown tolerates this.
 */
function MarkdownContentImpl({ content }: { content: string }) {
  return (
    <div className="message-markdown prose prose-sm prose-zinc max-w-none prose-p:my-2 prose-pre:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-headings:font-semibold prose-a:text-brand-600 prose-table:my-3 prose-th:bg-zinc-100 prose-th:px-3 prose-th:py-1.5 prose-td:px-3 prose-td:py-1.5 prose-td:border-t prose-td:border-zinc-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeHighlight, { detect: true, ignoreMissing: true }],
          [rehypeKatex, { throwOnError: false, errorColor: "#cc0000" }],
        ]}
        components={{
          // Open external links in a new tab
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownContent = memo(MarkdownContentImpl);