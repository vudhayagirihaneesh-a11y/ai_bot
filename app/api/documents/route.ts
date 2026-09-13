import { listDocuments } from "@/lib/store/vectorStore";
import { deleteDocument } from "@/lib/rag/pipeline";
import { checkApiKey, enforceRateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/documents — list knowledge base documents with chunk counts. */
export async function GET(): Promise<Response> {
  return Response.json(
    { documents: listDocuments() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** DELETE /api/documents?id=<docId> — remove a document and its chunks. */
export async function DELETE(req: Request): Promise<Response> {
  const unauthorized = checkApiKey(req);
  if (unauthorized) return unauthorized;

  const limited = enforceRateLimit(req, "upload");
  if (limited) return limited;

  const docId = new URL(req.url).searchParams.get("id");
  if (!docId) {
    return Response.json(
      { error: "Query parameter 'id' is required." },
      { status: 400 }
    );
  }

  const ok = await deleteDocument(docId);
  if (!ok) {
    return Response.json(
      { error: `Document ${docId} not found.` },
      { status: 404 }
    );
  }

  return Response.json({ deleted: docId });
}