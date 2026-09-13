/**
 * Preflight check: verifies Ollama, models, .env and node_modules.
 * Run with: npm run check-setup
 */
import { env } from "@/lib/env";
import {
  embeddingDimension,
  ollamaAlive,
  ollamaTags,
  hasModel,
} from "@/lib/ai/ollama";
import { indexStats } from "@/lib/store/vectorStore";

async function main() {
  const problems: string[] = [];

  console.log("\n┌─ Setup Check ───────────────────────────────┐");

  // Ollama daemon
  const alive = await ollamaAlive();
  console.log(`${alive ? "✔" : "✖"} Ollama daemon at ${env.ollama.baseUrl}`);
  if (!alive) problems.push("Ollama is not running. Launch the Ollama app or run `ollama serve`.");

  // Models
  if (alive) {
    const tags = await ollamaTags();
    for (const model of [env.ollama.chatModel, env.ollama.embedModel]) {
      const ready = hasModel(tags, model);
      console.log(`${ready ? "✔" : "✖"} Model "${model}" ${ready ? "pulled" : "missing"}`);
      if (!ready) problems.push(`Run: ollama pull ${model}`);
    }
    // Embedding round-trip
    try {
      const dim = await embeddingDimension();
      console.log(`✔ Embeddings working (dimension ${dim})`);
    } catch (err) {
      console.log("✖ Embedding round-trip failed");
      problems.push(`Embedding test failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Vector index
  const stats = indexStats();
  console.log(
    `${stats.documents > 0 ? "✔" : "⚠"} Knowledge base: ${stats.documents} documents, ${stats.chunks} chunks`
  );
  if (stats.documents === 0) {
    problems.push("Knowledge base is empty — run `npm run ingest` after dropping documents into ./rag_data");
  }

  console.log("└─────────────────────────────────────────────┘");

  if (problems.length > 0) {
    console.log("\nProblems to fix:");
    for (const p of problems) console.log(`  • ${p}`);
    process.exit(1);
  }

  console.log("\nEverything looks good! Start the app with: npm run dev\n");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});