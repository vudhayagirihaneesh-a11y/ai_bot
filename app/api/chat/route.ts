import { env } from "@/lib/env";
import { streamChat, type OllamaChatMessage } from "@/lib/ai/ollama";
import { retrieve } from "@/lib/rag/retriever";
import { SYSTEM_PROMPT, buildRetrievedContext, withContext } from "@/lib/rag/prompts";
import { checkApiKey, enforceRateLimit } from "@/lib/security/rateLimit";
import { retrieveFromWeb } from "@/lib/search/web";
import { uid } from "@/lib/utils";
import type { ChatStreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/chat — RAG query endpoint with SSE streaming.
 *
 * Flow: retrieve from KB → inject context → stream answer.
 * If no relevant chunks found, stream fallback message (no LLM call).
 */

interface ChatRequestBody {
  message?: string;
  history?: { role: "user" | "assistant"; content: string }[];
  docIds?: string[];
  conversationId?: string;
}

function sseEvent(event: ChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}

`;
}

export async function POST(req: Request): Promise<Response> {
  const unauthorized = checkApiKey(req);
  if (unauthorized) return unauthorized;

  const limited = enforceRateLimit(req, "chat");
  if (limited) return limited;

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const question = body.message?.trim();
  if (!question) {
    return Response.json({ error: "Missing message." }, { status: 400 });
  }

  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort());

  const stream = new ReadableStream({
    async start(readableController) {
      const send = (event: ChatStreamEvent): void => {
        try {
          readableController.enqueue(new TextEncoder().encode(sseEvent(event)));
        } catch (err) {
          if (err && err instanceof Error && err.name === "AbortError") {
            readableController.close();
          }
          throw err;
        }
      };

      try {

        // 1. Retrieval
        send({ type: "status", stage: "searching" });
        const result = await retrieve(question, body.docIds);

        // 1b. Restricted real-time web fallback — consulted when the KB has
        // no relevant chunks or the best similarity is below the reliability
        // threshold (env.web.fallbackScore). SSRF-guarded, re-ranked.
        type CtxChunk = Parameters<typeof buildRetrievedContext>[0][number];
        const kbChunks: CtxChunk[] = result.chunks;
        // Time-sensitive requests (date/day/time/weather) must consult the web
        // regardless of the similarity threshold — a math textbook can never
        // answer "what's today's date" even if a chunk scores above the gate.
        const requiresRealtime =
          /(\bweather\b)|(\bwhat('?s| is)?\s*(the\s*)?(today'?s\s*)?(date|day|time)\b)|(\btoday's date\b)/i.test(
            question
          );
        const kbWeak =
          kbChunks.length === 0 ||
          result.bestScore < env.web.fallbackScore ||
          requiresRealtime;
        let webChunks: CtxChunk[] = [];
        if (env.web.enabled && kbWeak) {
          send({ type: "status", stage: "searching_web" });
          const passages = await retrieveFromWeb(
            question,
            env.web.maxResults
          );
          webChunks = passages.map((p) => ({
            id: p.id,
            docId: "web",
            docName: p.title,
            page: null,
            chunkIndex: 0,
            text: p.text,
            score: p.score,
            url: p.url,
            source: "web" as const,
          }));
        }

        const chunks: CtxChunk[] =
          webChunks.length > 0 ? webChunks : kbChunks;

        if (chunks.length === 0) {
          send({ type: "citations", citations: [], usedContext: false });
          send({ type: "done", messageId: uid() });
          readableController.close();
          return;
        }

        send({
          type: "citations",
          citations: buildRetrievedContext(chunks).citations,
          usedContext: true,
        });

        // 2. Prompt construction
        const context = buildRetrievedContext(chunks);
        const history: OllamaChatMessage[] = (body.history ?? [])
          .slice(-env.retrieval.historyWindow)
          .map((m) => ({ role: m.role, content: m.content }));

        const today = new Date().toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });

        const messages: OllamaChatMessage[] = [
          {
            role: "system",
            content: `Today is ${today}. The server provides this date, so never claim you lack access to the current date or time. When asked for today's date, day, or time, answer with the date directly and do not mention the knowledge base, context, or sources for it.\n\n${withContext(
              SYSTEM_PROMPT,
              context.contextBlock
            )}`,
          },
          ...history,
          { role: "user", content: question },
        ];

        // 3. Streaming generation
        send({ type: "status", stage: "generating" });
        const messageId = uid();
        for await (const token of streamChat({
          messages,
          signal: controller.signal,
        })) {
          send({ type: "token", value: token });
        }
        send({ type: "done", messageId });

      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown server error";
        console.error("[chat] Error:", message);
        try {
          send({
            type: "error",
            message: message.includes("abort")
              ? "Generation stopped."
              : `Generation failed: ${message}`,
          });
        } catch {
          // If stream is already closed, skip
        }
      } finally {
        try { readableController.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
