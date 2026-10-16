"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type Dispatch } from "react";
import { deleteGraph, deleteProblem, saveGraph, saveProblem } from "@/app/actions";
import type { EvaluatedGraph } from "@/model/actions";
import { sanitizeId, type Problem, type StateSpaceGraph } from "@/model/schema";
import { missingProblemNodes, parseGraph, parseProblem, toGraphDocument, toProblemDocument } from "@/model/serialize";
import type { EditorAction, EditorState } from "@/state/editorReducer";
import type { StoredEntry } from "@/model/storageTypes";
import styles from "./Editor.module.css";

interface Index {
  graphs: StoredEntry[];
  problems: StoredEntry[];
}

type Status = { kind: "ok" | "error"; text: string } | null;

interface Props {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  evaluated: EvaluatedGraph;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return body;
}

export default function StoragePanel({ state, dispatch, evaluated }: Props) {
  const { graph, problem, dirty } = state;
  const [index, setIndex] = useState<Index>({ graphs: [], problems: [] });
  const [status, setStatus] = useState<Status>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setIndex((await fetchJson("/api")) as Index);
    } catch (err) {
      setStatus({ kind: "error", text: `Could not list server files: ${(err as Error).message}` });
    }
  }, []);

  useEffect(() => {
    // Initial load of the server index.
    let cancelled = false;
    fetchJson("/api")
      .then((data) => !cancelled && setIndex(data as Index))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const confirmDiscard = () => !dirty || confirm("You have unsaved changes. Discard them?");

  // ---- Server --------------------------------------------------------------

  const save = (withProblem: boolean) =>
    startTransition(async () => {
      const graphExists = index.graphs.some((g) => g.id === graph.id);
      const problemExists = withProblem && index.problems.some((p) => p.id === problem.id);
      const overwrite = [graphExists && `graph “${graph.id}”`, problemExists && `problem “${problem.id}”`].filter(Boolean);
      if (overwrite.length && !confirm(`Overwrite ${overwrite.join(" and ")} on the server?`)) return;

      const g = await saveGraph(toGraphDocument(graph, evaluated));
      if (!g.ok) return setStatus({ kind: "error", text: g.error });
      if (withProblem) {
        const p = await saveProblem(toProblemDocument(problem, graph, { evaluated }));
        if (!p.ok) return setStatus({ kind: "error", text: p.error });
        dispatch({ type: "markSaved" });
      }
      setStatus({ kind: "ok", text: withProblem ? `Saved graph “${g.id}” and problem “${problem.id}”.` : `Saved graph “${g.id}”.` });
      await refresh();
    });

  const openGraph = (id: string) => {
    if (!confirmDiscard()) return;
    startTransition(async () => {
      try {
        const r = parseGraph(await fetchJson(`/api/graphs/${encodeURIComponent(id)}`));
        if (!r.ok) return setStatus({ kind: "error", text: r.error });
        dispatch({ type: "load", graph: r.value });
        setStatus({ kind: "ok", text: `Opened graph “${r.value.name}”.` });
      } catch (err) {
        setStatus({ kind: "error", text: (err as Error).message });
      }
    });
  };

  const openProblem = (id: string) => {
    startTransition(async () => {
      try {
        const r = parseProblem(await fetchJson(`/api/problems/${encodeURIComponent(id)}`));
        if (!r.ok) return setStatus({ kind: "error", text: r.error });
        await applyProblem(r.value.problem, r.value.graph);
      } catch (err) {
        setStatus({ kind: "error", text: (err as Error).message });
      }
    });
  };

  /** Load a problem, also loading its graph from the server if it isn't the current one. */
  const applyProblem = async (p: Problem, embedded?: StateSpaceGraph) => {
    if (embedded) {
      if (!confirmDiscard()) return;
      dispatch({ type: "load", graph: embedded, problem: p, dirty: true });
      return setStatus({ kind: "ok", text: `Loaded problem “${p.name}” with its graph.` });
    }
    if (p.graphId === graph.id && missingProblemNodes(p, graph).length === 0) {
      dispatch({ type: "loadProblem", problem: p });
      return setStatus({ kind: "ok", text: `Loaded problem “${p.name}”.` });
    }
    if (!confirmDiscard()) return;
    const g = parseGraph(await fetchJson(`/api/graphs/${encodeURIComponent(p.graphId)}`));
    if (!g.ok) return setStatus({ kind: "error", text: `Problem's graph “${p.graphId}”: ${g.error}` });
    const missing = missingProblemNodes(p, g.value);
    dispatch({ type: "load", graph: g.value, problem: p });
    setStatus(
      missing.length
        ? { kind: "error", text: `Loaded, but the graph has no state(s) ${missing.join(", ")}.` }
        : { kind: "ok", text: `Loaded problem “${p.name}” and graph “${g.value.name}”.` },
    );
  };

  const remove = (kind: "graph" | "problem", id: string) => {
    if (!confirm(`Delete ${kind} “${id}” from the server? This can't be undone.`)) return;
    startTransition(async () => {
      const r = kind === "graph" ? await deleteGraph(id) : await deleteProblem(id);
      setStatus(r.ok ? { kind: "ok", text: `Deleted ${kind} “${id}”.` } : { kind: "error", text: r.error });
      await refresh();
    });
  };

  // ---- Local files ---------------------------------------------------------

  const download = (filename: string, data: unknown) => {
    const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File) => {
    try {
      const text = await file.text();
      const json: unknown = JSON.parse(text);
      if (json && typeof json === "object" && "graphId" in json) {
        const r = parseProblem(json);
        if (!r.ok) return setStatus({ kind: "error", text: r.error });
        await applyProblem(r.value.problem, r.value.graph);
      } else {
        const r = parseGraph(json);
        if (!r.ok) return setStatus({ kind: "error", text: r.error });
        if (!confirmDiscard()) return;
        dispatch({ type: "load", graph: r.value, dirty: true });
        setStatus({ kind: "ok", text: `Imported graph “${r.value.name}”.` });
      }
    } catch (err) {
      setStatus({ kind: "error", text: `Import failed: ${(err as Error).message}` });
    }
  };

  const graphIdTaken = index.graphs.some((g) => g.id === graph.id);
  const problemsForGraph = index.problems.filter((p) => p.graphId === graph.id);
  const otherProblems = index.problems.filter((p) => p.graphId !== graph.id);

  return (
    <div className={styles.sectionBody}>
      <label className={styles.field}>
        <span>Graph file id</span>
        <input
          value={graph.id}
          onChange={(e) => dispatch({ type: "setGraphMeta", patch: { id: sanitizeId(e.target.value) } })}
        />
      </label>
      <label className={styles.field}>
        <span>Problem file id</span>
        <input
          value={problem.id}
          onChange={(e) => dispatch({ type: "setProblem", patch: { id: sanitizeId(e.target.value) } })}
        />
      </label>
      <div className={styles.row}>
        <button className="primary" disabled={pending} onClick={() => save(true)}>
          Save graph + problem
        </button>
        <button disabled={pending} onClick={() => save(false)}>
          Save graph only
        </button>
      </div>
      {graphIdTaken && <p className={styles.muted}>A graph with id “{graph.id}” exists on the server; saving overwrites it.</p>}
      {status && <p className={`${styles.status} ${status.kind === "error" ? styles.error : styles.okText}`}>{status.text}</p>}

      <div className={styles.row} style={{ justifyContent: "space-between" }}>
        <strong>On the server</strong>
        <button disabled={pending} onClick={() => startTransition(refresh)}>
          Refresh
        </button>
      </div>
      <FileList
        title="Graphs"
        entries={index.graphs}
        current={graph.id}
        hrefFor={(id) => `/api/graphs/${id}`}
        onOpen={openGraph}
        onDelete={(id) => remove("graph", id)}
        disabled={pending}
      />
      <FileList
        title={`Problems for “${graph.id}”`}
        entries={problemsForGraph}
        current={problem.id}
        hrefFor={(id) => `/api/problems/${id}`}
        onOpen={openProblem}
        onDelete={(id) => remove("problem", id)}
        disabled={pending}
      />
      {otherProblems.length > 0 && (
        <FileList
          title="Other problems"
          entries={otherProblems}
          hrefFor={(id) => `/api/problems/${id}`}
          onOpen={openProblem}
          onDelete={(id) => remove("problem", id)}
          disabled={pending}
        />
      )}

      <strong>Local JSON files</strong>
      <div className={styles.row}>
        <button onClick={() => download(`${graph.id}.graph.json`, toGraphDocument(graph, evaluated))}>Export graph</button>
        <button
          onClick={() =>
            download(`${problem.id}.problem.json`, toProblemDocument(problem, graph, { evaluated, embedGraph: true }))
          }
        >
          Export problem
        </button>
        <button onClick={() => fileInput.current?.click()}>Import…</button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importFile(file);
          }}
        />
      </div>
      <p className={styles.muted}>
        Files include derived data (edge costs, ACTIONS(s), h-table) for use by search code; the editor recomputes it on
        load. Exported problems embed their graph.
      </p>
    </div>
  );
}

function FileList({
  title,
  entries,
  current,
  hrefFor,
  onOpen,
  onDelete,
  disabled,
}: {
  title: string;
  entries: StoredEntry[];
  current?: string;
  hrefFor: (id: string) => string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <p className={styles.muted}>{title}</p>
      {entries.length === 0 ? (
        <p className={styles.muted}>—</p>
      ) : (
        <ul className={styles.fileList}>
          {entries.map((e) => (
            <li key={e.id}>
              <span title={`${e.name} (${e.id})`}>
                {e.id === current ? <strong>{e.name}</strong> : e.name}{" "}
                <code className={styles.muted}>{e.id}</code>
              </span>
              <button disabled={disabled} onClick={() => onOpen(e.id)}>
                Open
              </button>
              <a href={`${hrefFor(e.id)}?download=1`} title="Download JSON">
                JSON
              </a>
              <button className="danger" disabled={disabled} onClick={() => onDelete(e.id)} aria-label={`Delete ${e.id}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
