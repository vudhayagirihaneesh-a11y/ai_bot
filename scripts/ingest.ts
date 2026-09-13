/**
 * CLI ingestion script — indexes documents from a local folder into the
 * vector store without going through the web upload endpoint.
 *
 * Usage:
 *   npm run ingest                       → indexes everything in ./rag_data
 *   npm run ingest -- path/to/file.pdf   → indexes a specific file
 *   npm run ingest -- --reset            → wipes the knowledge base first
 */
import fs from "fs/promises";
import path from "path";
import { env, uploadDir } from "@/lib/env";
import { isAllowedExtension } from "@/lib/rag/parsers";
import { ingestDocument } from "@/lib/rag/pipeline";
import { embeddingDimension, resetKnowledgeBase } from "@/lib/rag/pipeline";
import { indexStats, persistNow } from "@/lib/store/vectorStore";
import { ollamaAlive, ollamaTags, hasModel } from "@/lib/ai/ollama";

const DEFAULT_DATA_DIR = path.resolve("./rag_data");

async function main() {
  const args = process.argv.slice(2);

  console.log("\n┌─ RAG Ingestion ─────────────────────────────┐");

  // ── Preflight: Ollama daemon + models ──────────────────────────────────
  const alive = await ollamaAlive();
  if (!alive) {
    console.error("✖ Ollama is not reachable at", env.ollama.baseUrl);
    console.error("  Start it with: `ollama serve` (or launch the Ollama app).");
    process.exit(1);
  }
  const tags = await ollamaTags();
  for (const model of [env.ollama.embedModel, env.ollama.chatModel]) {
    if (!hasModel(tags, model)) {
      console.error(`✖ Model "${model}" is not pulled. Run: ollama pull ${model}`);
      process.exit(1);
    }
  }
  console.log(`✔ Ollama ready (${env.ollama.embedModel} + ${env.ollama.chatModel})`);

  const dim = await embeddingDimension();
  console.log(`✔ Embedding dimension: ${dim}`);

  // ── Optional reset ─────────────────────────────────────────────────────
  if (args.includes("--reset")) {
    await resetKnowledgeBase();
    console.log("✔ Knowledge base reset");
  }

  // ── Resolve targets ────────────────────────────────────────────────────
  const positional = args.filter((a) => !a.startsWith("--"));
  const targets: string[] = [];

  if (positional.length > 0) {
    for (const p of positional) {
      const resolved = path.resolve(p);
      const stat = await fs.stat(resolved).catch(() => null);
      if (!stat) {
        console.error(`✖ Not found: ${resolved}`);
        process.exit(1);
      }
      if (stat.isDirectory()) {
        targets.push(resolved);
      } else {
        targets.push(resolved);
      }
    }
  } else {
    targets.push(DEFAULT_DATA_DIR);
    await fs.mkdir(DEFAULT_DATA_DIR, { recursive: true });
  }

  // ── Collect files ──────────────────────────────────────────────────────
  const files: string[] = [];
  for (const target of targets) {
    const stat = await fs.stat(target);
    if (stat.isFile()) {
      if (isAllowedExtension(target)) files.push(target);
      else console.warn(`⚠ Skipping unsupported file: ${path.basename(target)}`);
    } else {
      const entries = await fs.readdir(target, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && isAllowedExtension(entry.name)) {
          files.push(path.join(target, entry.name));
        }
      }
    }
  }

  if (files.length === 0) {
    console.log(`⚠ No indexable documents found in: ${targets.join(", ")}`);
    console.log("  Supported:", env.allowedExtensions.join(", "));
    console.log(`  Tip: drop files into ${DEFAULT_DATA_DIR} and re-run.`);
    process.exit(0);
  }

  console.log(`✔ Found ${files.length} document(s):`);
  for (const f of files) console.log(`   • ${path.basename(f)}`);
  console.log("└─────────────────────────────────────────────┘\n");

  // ── Ingest each ────────────────────────────────────────────────────────
  let ok = 0;
  let failed = 0;
  for (const file of files) {
    const name = path.basename(file);
    try {
      const result = await ingestDocument({
        filePath: file,
        onProgress: (e) => {
          if (e.stage === "embedding" && e.progress != null) {
            const pct = Math.round(e.progress * 100);
            process.stdout.write(`   ${name}: embedding ${pct}%\r`);
          }
        },
      });
      ok++;
      process.stdout.write("".padEnd(80) + "\r");
      console.log(
        `✔ ${name} → ${result.document.chunks} chunks` +
          (result.document.pages != null ? ` (${result.document.pages} pages)` : "")
      );
    } catch (err) {
      failed++;
      process.stdout.write("".padEnd(80) + "\r");
      console.error(`✖ ${name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  persistNow();
  const stats = indexStats();
  console.log("\n─────────────────────────────────────────────");
  console.log(`Done: ${ok} indexed, ${failed} failed`);
  console.log(
    `Knowledge base: ${stats.documents} documents, ${stats.chunks} chunks, dim=${stats.dimension}`
  );
  console.log("Start the app with: npm run dev");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});