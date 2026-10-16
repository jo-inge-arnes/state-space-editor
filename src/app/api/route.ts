import { listGraphs, listProblems, StorageError } from "@/server/storage";

/** Index of everything stored on the server. */
export async function GET() {
  try {
    const [graphs, problems] = await Promise.all([listGraphs(), listProblems()]);
    return Response.json({ graphs, problems }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof StorageError) return Response.json({ error: err.message }, { status: 503 });
    throw err;
  }
}
