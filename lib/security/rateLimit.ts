import { env } from "@/lib/env";

/**
 * In-memory sliding-window rate limiter (per client IP).
 * For a multi-instance deployment swap this for Redis.
 */

interface Bucket {
  hits: number[];
}

const globalLimiter = globalThis as unknown as {
  __ragRateBuckets?: Map<string, Bucket>;
};

function buckets(): Map<string, Bucket> {
  if (!globalLimiter.__ragRateBuckets) {
    globalLimiter.__ragRateBuckets = new Map();
  }
  return globalLimiter.__ragRateBuckets;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "local";
}

function gc(now: number): void {
  const map = buckets();
  // Lazy garbage collection: only when map grows large
  if (map.size < 500) return;
  for (const [key, bucket] of map) {
    bucket.hits = bucket.hits.filter(
      (t) => now - t < env.rate.windowMs
    );
    if (bucket.hits.length === 0) map.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Sliding window limiter. Returns ok=false and retryAfterSec when the
 * client exceeded `maxRequests` within env.rate.windowMs.
 */
export function rateLimit(
  req: Request,
  scope: "chat" | "upload",
  maxRequests: number
): RateLimitResult {
  const now = Date.now();
  gc(now);
  const key = `${scope}:${clientIp(req)}`;
  const map = buckets();
  const bucket = map.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < env.rate.windowMs);

  if (bucket.hits.length >= maxRequests) {
    const oldest = bucket.hits[0];
    const retryAfterSec = Math.max(
      1,
      Math.ceil((env.rate.windowMs - (now - oldest)) / 1000)
    );
    map.set(key, bucket);
    return { ok: false, remaining: 0, retryAfterSec };
  }

  bucket.hits.push(now);
  map.set(key, bucket);
  return {
    ok: true,
    remaining: maxRequests - bucket.hits.length,
    retryAfterSec: 0,
  };
}

/**
 * Guard helper for mutating API routes. Returns a 429 Response when the
 * client is over the limit, otherwise null.
 */
export function enforceRateLimit(
  req: Request,
  scope: "chat" | "upload"
): Response | null {
  const max =
    scope === "chat" ? env.rate.chatRequests : env.rate.uploadRequests;
  const result = rateLimit(req, scope, max);
  if (result.ok) return null;
  return Response.json(
    {
      error: "Rate limit exceeded. Please slow down.",
      retryAfterSec: result.retryAfterSec,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSec),
        "X-RateLimit-Remaining": "0",
      },
    }
  );
}

/**
 * Optional API key guard. When API_KEY is set in .env, mutating routes
 * must include the header `x-api-key: <value>`. Returns a 401 Response
 * when the key is missing or wrong, otherwise null.
 */
export function checkApiKey(req: Request): Response | null {
  const expected = env.security.apiKey;
  if (!expected) return null; // disabled (local dev)
  const provided = req.headers.get("x-api-key");
  if (provided === expected) return null;
  return Response.json(
    { error: "Unauthorized: missing or invalid x-api-key header." },
    { status: 401 }
  );
}