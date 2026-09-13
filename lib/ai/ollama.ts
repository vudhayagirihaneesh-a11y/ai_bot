import { env } from "@/lib/env";

/**
 * Minimal typed Ollama HTTP client (native fetch, streaming via NDJSON).
 * Covers: health check, batch embeddings, streaming chat generation.
 */

/**
 * Common headers for all Ollama requests. Includes the ngrok header
 * to bypass the free-tier interstitial warning page when tunnelling.
 */
const ollamaHeaders: Record<string, string> = {
  "ngrok-skip-browser-warning": "true",
};

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaTag {
  name: string;
}

// ── Health ────────────────────────────────────────────────────────────────────

export async function ollamaAlive(timeoutMs = 8000): Promise<boolean> {
  try {
    const res = await fetch(`${env.ollama.baseUrl}/api/tags`, {
      headers: ollamaHeaders,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function ollamaTags(): Promise<string[]> {
  try {
    const res = await fetch(`${env.ollama.baseUrl}/api/tags`, {
      headers: ollamaHeaders,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { models?: OllamaTag[] };
    return (json.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

/** True when `model` is present in tags (tags may include ":latest"). */
export function hasModel(tags: string[], model: string): boolean {
  const base = model.includes(":") ? model : `${model}:latest`;
  return tags.some(
    (t) => t === model || t === base || t === `${model}:latest`
  );
}

// ── Embeddings (batch) ────────────────────────────────────────────────────────

export async function embedTexts(
  texts: string[],
  timeoutMs = 120_000
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch(`${env.ollama.baseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ollamaHeaders },
    body: JSON.stringify({
      model: env.ollama.embedModel,
      input: texts,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Ollama embed failed (${res.status}): ${body.slice(0, 300)}`
    );
  }
  const json = (await res.json()) as { embeddings: number[][] };
  return json.embeddings;
}

export async function embedText(
  text: string,
  timeoutMs = 60_000
): Promise<number[]> {
  const [vec] = await embedTexts([text], timeoutMs);
  if (!vec) throw new Error("Ollama returned no embedding vector");
  return vec;
}

export async function embeddingDimension(): Promise<number> {
  const vec = await embedText("dimension probe");
  return vec.length;
}

// ── Streaming chat generation ─────────────────────────────────────────────────

export interface StreamChatOptions {
  messages: OllamaChatMessage[];
  temperature?: number;
  signal?: AbortSignal;
  onToken?: (token: string) => void;
}

/**
 * Streams a chat completion from Ollama. Yields tokens as they arrive.
 * Falls back to a non-streaming request if the stream response fails.
 */
export async function* streamChat(
  opts: StreamChatOptions
): AsyncGenerator<string> {
  const res = await fetch(`${env.ollama.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ollamaHeaders },
    body: JSON.stringify({
      model: env.ollama.chatModel,
      messages: opts.messages,
      stream: true,
      options: {
        temperature: opts.temperature ?? 0.2,
        num_ctx: 8192,
      },
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Ollama chat failed (${res.status}): ${body.slice(0, 300)}`
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx = buffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      newlineIdx = buffer.indexOf("\n");
      if (!line) continue;

      try {
        const chunk = JSON.parse(line) as {
          message?: { content?: string };
          done?: boolean;
          error?: string;
        };
        if (chunk.error) throw new Error(chunk.error);
        const token = chunk.message?.content ?? "";
        if (token) {
          opts.onToken?.(token);
          yield token;
        }
      } catch (err) {
        if (err instanceof SyntaxError) continue; // partial line, skip
        throw err;
      }
    }
  }
}
// ── Non-streaming completion (short verdicts, e.g. topic classification) ─────

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

/**
 * Single-shot non-streaming completion. Used for cheap, fast verdicts
 * (like the maths-topic classifier) where streaming is overkill.
 */
export async function chatCompletion(
  messages: OllamaChatMessage[],
  opts: CompletionOptions = {}
): Promise<string> {
  const res = await fetch(`${env.ollama.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ollamaHeaders },
    body: JSON.stringify({
      model: env.ollama.chatModel,
      messages,
      stream: false,
      options: {
        temperature: opts.temperature ?? 0,
        num_predict: opts.maxTokens ?? 8,
      },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Ollama completion failed (${res.status}): ${body.slice(0, 200)}`
    );
  }
  const json = (await res.json()) as { message?: { content?: string } };
  return json.message?.content ?? "";
}