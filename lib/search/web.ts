import { env } from "@/lib/env";
import { embedTexts } from "@/lib/ai/ollama";
import { cosineSimilarity } from "@/lib/store/vectorStore";

/**
 * RESTRICTED web-search fallback.
 *
 * Ground rules (by design):
 *  - Only consulted when the knowledge base has NO relevant chunks.
 *  - Fetches at most `maxResults` pages, caps each page's text, and
 *    applies hard timeouts — the web is a fallback, not a replacement.
 *  - Search: DuckDuckGo HTML/Lite endpoints (no API key required).
 *  - Passages from fetched pages are re-ranked against the question with
 *    the local embedding model, so only the most relevant web text
 *    reaches the LLM.
 *  - SSRF guard: private/loopback hosts are never fetched.
 */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MathsAI-RAG/1.0 (local research assistant)";

const PRIVATE_HOST =
  /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1|\[::1\]|.*\.local)$/i;

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&#x2F;": "/",
  "&nbsp;": " ",
};

function decodeHtml(text: string): string {
  return text.replace(
    /&(amp|lt|gt|quot|#39|#x27|#x2F|nbsp);/g,
    (m) => HTML_ENTITIES[m] ?? m
  );
}

function stripTags(html: string): string {
  return decodeHtml(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (PRIVATE_HOST.test(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/** DDG wraps real URLs in /l/?uddg=<encoded> redirects — unwrap them. */
function unwrapUrl(href: string): string | null {
  try {
    const raw = href.startsWith("//") ? `https:${href}` : href;
    if (raw.includes("uddg=")) {
      const u = new URL(raw);
      const real = u.searchParams.get("uddg");
      return real && isSafeUrl(real) ? real : null;
    }
    return isSafeUrl(raw) ? raw : null;
  } catch {
    return null;
  }
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** DuckDuckGo HTML endpoint (primary). */
async function ddgHtml(
  query: string,
  maxResults: number
): Promise<WebSearchResult[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams({ q: query }).toString(),
    signal: AbortSignal.timeout(env.web.timeoutMs),
  });
  if (!res.ok) return [];
  const html = await res.text();

  const anchors = [
    ...html.matchAll(
      /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    ),
  ];
  const snippets = [
    ...html.matchAll(
      /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
    ),
  ];

  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < anchors.length && results.length < maxResults; i++) {
    const url = unwrapUrl(anchors[i][1]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    results.push({
      title: stripTags(anchors[i][2]).slice(0, 200),
      url,
      snippet: snippets[i] ? stripTags(snippets[i][1]).slice(0, 400) : "",
    });
  }
  return results;
}

/** DuckDuckGo Lite endpoint (fallback when HTML returns nothing). */
async function ddgLite(
  query: string,
  maxResults: number
): Promise<WebSearchResult[]> {
  const res = await fetch(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(env.web.timeoutMs),
    }
  );
  if (!res.ok) return [];
  const html = await res.text();

  const matches = [
    ...html.matchAll(
      /href="((?:https?:)?\/\/duckduckgo\.com\/l\/\?uddg=[^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    ),
  ];

  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    if (results.length >= maxResults) break;
    const url = unwrapUrl(m[1]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    results.push({ title: stripTags(m[2]).slice(0, 200), url, snippet: "" });
  }
  return results;
}

export async function webSearch(
  query: string,
  maxResults: number
): Promise<WebSearchResult[]> {
  try {
    const primary = await ddgHtml(query, maxResults);
    if (primary.length > 0) return primary;
    return await ddgLite(query, maxResults);
  } catch (err) {
    console.error(
      "[web] search failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/** Fetch a page and extract readable plain text (scripts/styles stripped). */
export async function fetchPageText(
  url: string,
  maxChars: number
): Promise<string> {
  if (!isSafeUrl(url)) throw new Error(`Blocked unsafe URL: ${url}`);
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain" },
    signal: AbortSignal.timeout(env.web.timeoutMs),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("html") && !contentType.includes("text")) {
    throw new Error(`Non-text content-type: ${contentType}`);
  }
  // Cap raw download before processing
  const raw = (await res.text()).slice(0, 400_000);
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  return decodeHtml(text).replace(/\s+/g, " ").trim().slice(0, maxChars);
}

export interface WebPassage {
  id: string;
  title: string;
  url: string;
  text: string;
  score: number;
}

/**
 * Full restricted web fallback: search → fetch pages → split into
 * passages → embed + cosine rerank against the question → top results.
 */
export async function retrieveFromWeb(
  question: string,
  maxResults: number
): Promise<WebPassage[]> {
  const hits = await webSearch(question, maxResults);
  if (hits.length === 0) return [];

  // Fetch pages sequentially (politeness + simplicity)
  const pages: { title: string; url: string; text: string }[] = [];
  for (const hit of hits) {
    try {
      const text = await fetchPageText(hit.url, env.web.pageMaxChars);
      if (text.length > 200) {
        pages.push({ title: hit.title || hit.url, url: hit.url, text });
      }
    } catch (err) {
      console.error(
        "[web] page fetch skipped:",
        err instanceof Error ? err.message : err
      );
    }
  }
  if (pages.length === 0) return [];

  // Split into passages (~900 chars), max 4 per page
  const passages: { title: string; url: string; text: string }[] = [];
  for (const page of pages) {
    let perPage = 0;
    const sentences = page.text.split(/(?<=[.!?])\s+/);
    let buffer = "";
    for (const sentence of sentences) {
      if (buffer.length + sentence.length > 900 && buffer.length > 100) {
        passages.push({ title: page.title, url: page.url, text: buffer });
        perPage++;
        buffer = "";
        if (perPage >= 4) break;
      }
      buffer += (buffer ? " " : "") + sentence;
    }
    if (buffer.length > 100 && perPage < 4) {
      passages.push({ title: page.title, url: page.url, text: buffer });
    }
  }

  // Embed + rerank against the question (semantic precision)
  try {
    const vectors = await embedTexts([
      question,
      ...passages.map((p) => p.text.slice(0, 2000)),
    ]);
    const queryVec = vectors[0];
    const scored = passages.map((p, i) => ({
      ...p,
      score: cosineSimilarity(queryVec, vectors[i + 1]),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults).map((p, i) => ({
      ...p,
      id: `web-${i}-${p.url.slice(0, 60)}`,
    }));
  } catch {
    // Embedding unavailable — return passages unranked (still grounded)
    return passages.slice(0, maxResults).map((p, i) => ({
      ...p,
      id: `web-${i}-${p.url.slice(0, 60)}`,
      score: 0.5,
    }));
  }
}