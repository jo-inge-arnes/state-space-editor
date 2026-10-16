import { listGraphs, listProblems } from "@/server/storage";

/** Index of everything stored on the server. */
export async function GET() {
  const [graphs, problems] = await Promise.all([listGraphs(), listProblems()]);
  return Response.json({ graphs, problems }, { headers: { "cache-control": "no-store" } });
}
