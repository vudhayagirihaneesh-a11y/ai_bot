# Maths AI — Local Knowledge Assistant

A production-ready, **fully local** RAG (Retrieval-Augmented Generation) chatbot.
Next.js 15 frontend + API routes, **Ollama** for LLM & embeddings, and a
persistent local vector store. No API keys, no cloud — your documents never
leave your machine.

## Features

- 💬 Streaming chat (SSE) with markdown rendering + syntax-highlighted code blocks
- 📚 Knowledge base: upload **PDF / DOCX / TXT / MD** (drag & drop, live per-stage progress)
- 🔍 RAG pipeline: chunking → embeddings → cosine top-k retrieval → lexical rerank → cited answers
- 🛡️ Hallucination guard: fixed fallback answer when no relevant chunks are found
- 🗂️ Conversation history persisted in localStorage
- 🩺 Health panel (Ollama daemon + model status), rate limiting, optional API key, magic-byte file validation

## Project structure

```
ai_bot/
├── app/
│   ├── api/
│   │   ├── chat/route.ts        # POST — RAG query, SSE token stream
│   │   ├── upload/route.ts      # POST — multipart upload, SSE progress
│   │   ├── documents/route.ts   # GET list / DELETE ?id=
│   │   └── health/route.ts      # GET — Ollama + index status
│   ├── layout.tsx               # Root layout
│   ├── page.tsx                 # Chat surface
│   └── globals.css              # Tailwind v4 + typography + hljs theme
├── components/                  # ChatBubble, CitationPanel, MarkdownContent,
│   │                            # Sidebar, UploadModal, UploadList, EmptyState
├── hooks/                       # useConversations, useChatStream, useUpload
├── lib/
│   ├── ai/ollama.ts             # Typed Ollama client (embed + stream chat)
│   ├── rag/
│   │   ├── parsers.ts           # PDF (pdfjs) / DOCX (mammoth) / TXT / MD
│   │   ├── chunker.ts           # RecursiveCharacterTextSplitter-style
│   │   ├── retriever.ts         # Vector search + lexical rerank
│   │   ├── prompts.ts           # System prompt + context injection
│   │   └── pipeline.ts          # parse → chunk → embed → upsert
│   ├── search/
│   │   └── web.ts               # RESTRICTED web fallback (DDG + rerank)
│   ├── store/vectorStore.ts     # Persistent JSON vector index (cosine)
│   ├── security/                # rateLimit.ts, validation.ts
│   ├── env.ts                   # Typed env config
│   ├── types.ts                 # Shared types (SSE events, citations…)
│   └── utils.ts                 # cn(), formatBytes, uid…
├── scripts/
│   ├── ingest.ts                # CLI bulk ingestion (npm run ingest)
│   └── check-setup.ts           # Preflight checks (npm run check-setup)
├── rag_data/                    # Drop documents here for CLI ingestion
├── data/                        # Vector index + uploads (gitignored)
├── .env.example                 # All configuration knobs
└── package.json
```

## Setup

### 0. Prerequisites

- **Node.js ≥ 20** — `node --version`
- **Ollama ≥ 0.3** — <https://ollama.com/download>

### 1. Install dependencies

```powershell
npm install
```

### 2. Pull the models (one-time, ~2.3 GB)

```powershell
ollama pull llama3.2:3b      # chat model
ollama pull nomic-embed-text # embeddings (768-dim)
```

### 3. Configure (optional)

`.env` is pre-created with local defaults; copy `.env.example` to customize:

```ini
OLLAMA_CHAT_MODEL=llama3.2:3b     # any Ollama chat model
OLLAMA_EMBED_MODEL=nomic-embed-text
TOP_K=5                           # chunks retrieved per query
RELEVANCE_THRESHOLD=0.3           # hallucination guard sensitivity
API_KEY=                          # set to require x-api-key on mutations
```

### 4. Verify setup

```powershell
npm run check-setup
```

Checks Ollama daemon, both models, embedding round-trip and index stats.

### 5. Ingest documents

**Option A — CLI (bulk):** drop files into `./rag_data/` then:

```powershell
npm run ingest            # indexes everything in ./rag_data
npm run ingest -- path/to/file.pdf   # single file
npm run ingest -- --reset # wipe the knowledge base first
```

**Option B — Web UI:** click **Upload** in the sidebar → drag & drop →
watch per-file progress (Parsing → Chunking → Embedding % → Indexed).

### 6. Run

```powershell
npm run dev
```

Open <http://localhost:3000>. Production: `npm run build && npm start`.

## How RAG works here

1. **Ingestion** — files are parsed (pdfjs-dist preserves page numbers,
   mammoth for DOCX), split with a recursive splitter (~600 tokens/chunk,
   15% overlap), embedded in batches of 16 via `nomic-embed-text`, and
   upserted with `{docId, docName, page, chunkIndex}` metadata.
2. **Query** — the question is embedded, cosine similarity fetches a
   candidate pool (top-k × 3), a lexical-overlap reranker boosts chunks
   containing the query terms, and the top-k above `RELEVANCE_THRESHOLD`
   are injected as numbered context.
3. **Restricted web fallback** — if (and only if) the knowledge base has
   no relevant chunks, Maths AI searches the web (DuckDuckGo, no API
   key), fetching at most `WEB_MAX_RESULTS` pages with hard timeouts and
   size caps (SSRF-guarded), re-ranks the passages against your question
   with the local embedding model, and answers with **(web)**-labelled
   citations. Disable entirely with `WEB_SEARCH_ENABLED=false`.
4. **Generation** — the system prompt instructs the model to cite `[1]`,
   `[2]`… and to answer *"I couldn't find the answer to that in the
   knowledge base"* when neither documents nor web fallback yield usable
   context. If retrieval is empty the LLM is **skipped entirely** and the
   fallback is streamed.
5. **Streaming** — tokens stream to the browser as SSE events
   (`status` → `citations` → `token`* → `done`); citations arrive first so
   the UI can show sources while the answer is being written. Web
   citations show a 🌐 badge and a clickable source link.

## API quick reference

| Method | Route | Description |
|---|---|---|
| POST | `/api/chat` | `{message, history?, docIds?}` → SSE stream |
| POST | `/api/upload` | multipart `file` → SSE progress stream |
| GET | `/api/documents` | List indexed documents |
| DELETE | `/api/documents?id=` | Remove document + chunks |
| GET | `/api/health` | Ollama/model/index status |

## Swapping the vector store

`lib/store/vectorStore.ts` exposes `addDocument / search / listDocuments /
removeDocument` — the same surface as ChromaDB/pgvector clients. To scale
beyond a single machine, re-implement that module against a real vector DB;
nothing else changes.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Ollama offline` badge | Start Ollama: `ollama serve` |
| `Chat model missing` | `ollama pull llama3.2:3b` |
| `Embed model missing` | `ollama pull nomic-embed-text` |
| Slow first answer | Model cold-start; later answers are faster |
| Scanned PDF yields no text | No OCR layer — run OCR first, re-ingest |
| Changed embedding model | Delete `data/vector_index.json`, re-ingest |

