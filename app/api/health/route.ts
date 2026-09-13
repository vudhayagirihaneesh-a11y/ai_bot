import { env } from "@/lib/env";
import { ollamaAlive, ollamaTags, hasModel } from "@/lib/ai/ollama";
import { indexStats } from "@/lib/store/vectorStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/health — daemon status, model availability, index stats. */
export async function GET(): Promise<Response> {
  const [alive, tags] = await Promise.all([ollamaAlive(), ollamaTags()]);
  const stats = indexStats();

  return Response.json(
    {
      ollama: {
        alive,
        baseUrl: env.ollama.baseUrl,
        chatModel: env.ollama.chatModel,
        chatModelReady: alive && hasModel(tags, env.ollama.chatModel),
        embedModel: env.ollama.embedModel,
        embedModelReady: alive && hasModel(tags, env.ollama.embedModel),
      },
      index: stats,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}