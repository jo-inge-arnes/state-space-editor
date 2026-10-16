import type { Metadata } from "next";
import { Suspense } from "react";
import Editor from "@/components/Editor";
import type { Problem, StateSpaceGraph } from "@/model/schema";
import { parseGraph, parseProblem } from "@/model/serialize";
import { readGraph, readProblem } from "@/server/storage";

export const metadata: Metadata = { title: "Editor" };

export default function EditorPage({ searchParams }: PageProps<"/editor">) {
  return (
    <Suspense fallback={<p style={{ padding: 16 }}>Loading editor…</p>}>
      <EditorLoader searchParams={searchParams} />
    </Suspense>
  );
}

/** Loads ?graph=<id> and/or ?problem=<id> from server storage and hands them to the client editor. */
async function EditorLoader({ searchParams }: Pick<PageProps<"/editor">, "searchParams">) {
  const params = await searchParams;
  const graphId = typeof params.graph === "string" ? params.graph : undefined;
  const problemId = typeof params.problem === "string" ? params.problem : undefined;

  let graph: StateSpaceGraph | undefined;
  let problem: Problem | undefined;
  let error: string | undefined;

  try {
    if (problemId) {
      const doc = await readProblem(problemId);
      const parsed = doc && parseProblem(doc);
      if (!parsed) error = `Problem “${problemId}” not found.`;
      else if (!parsed.ok) error = parsed.error;
      else problem = parsed.value.problem;
    }
    const gid = graphId ?? problem?.graphId;
    if (gid) {
      const doc = await readGraph(gid);
      const parsed = doc && parseGraph(doc);
      if (!parsed) error = `Graph “${gid}” not found.`;
      else if (!parsed.ok) error = parsed.error;
      else graph = parsed.value;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  if (problem && (!graph || problem.graphId !== graph.id)) problem = undefined;

  // Key by what was requested so navigating to another file starts a fresh editor.
  return (
    <Editor
      key={`${graph?.id ?? ""}/${problem?.id ?? ""}`}
      initialGraph={graph}
      initialProblem={problem}
      loadError={error}
    />
  );
}
