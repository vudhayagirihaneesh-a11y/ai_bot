import { listDocuments } from "@/lib/store/vectorStore";
import { deleteDocument } from "@/lib/rag/pipeline";
import { checkApiKey, enforceRateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/documents — list knowledge base documents with chunk counts. */
export async function GET(): Promise<Response> {
  return Response.json(
    { documents: await listDocuments() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** DELETE /api/documents?id=<docId> — remove a document and its chunks. */
export async function DELETE(req: Request): Promise<Response> {
  const unauthorized = checkApiKey(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return Response.json(
      { error: "Missing id parameter" },
      { status: 400 }
    );
  }

  const ok = await deleteDocument(id);
  if (!ok) {
    return Response.json(
      { error: `Document ${id} not found.` },
      { status: 404 }
    );
  }

  return Response.json({ deleted: id });
}