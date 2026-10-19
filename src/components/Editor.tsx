"use client";

import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { evaluateGraph } from "@/model/actions";
import { computeHeuristicTable } from "@/model/heuristics/registry";
import type { Problem, StateSpaceGraph } from "@/model/schema";
import { parseGraph, parseProblem } from "@/model/serialize";
import { editorReducer, initialEditorState, sampleState, type EditorState } from "@/state/editorReducer";
import Canvas from "./Canvas";
import CostModelPanel from "./CostModelPanel";
import HPanel, { useHTool } from "./HPanel";
import Inspector from "./Inspector";
import LengthPanel, { useLengthTool } from "./LengthPanel";
import ProblemPanel from "./ProblemPanel";
import StoragePanel from "./StoragePanel";
import Toolbar from "./Toolbar";
import { useSessionMarks } from "./tools";
import TransitionPanel from "./TransitionPanel";
import styles from "./Editor.module.css";

const AUTOSAVE_KEY = "state-space-editor:autosave";

interface Props {
  /** Graph/problem opened from server storage via the URL; otherwise the autosave or an example is used. */
  initialGraph?: StateSpaceGraph;
  initialProblem?: Problem;
  loadError?: string;
}

export default function Editor({ initialGraph, initialProblem, loadError }: Props) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => {
    if (initialGraph) return initialEditorState(initialGraph, initialProblem);
    const sample = sampleState();
    return initialEditorState(sample.graph, sample.problem);
  });
  const [showH, setShowH] = useState(true);
  const [snap, setSnap] = useState(false);
  const [renameRequest, setRenameRequest] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  // On narrow screens the side panel is a bottom sheet; on wide screens this flag is ignored.
  const [sheetOpen, setSheetOpen] = useState(false);

  // Restore the browser autosave (only when nothing was opened from the server).
  useEffect(() => {
    if (!initialGraph) {
      try {
        const saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? "null");
        const g = saved && parseGraph(saved.graph);
        if (g?.ok) {
          const p = saved.problem ? parseProblem(saved.problem) : null;
          dispatch({ type: "load", graph: g.value, problem: p?.ok ? p.value.problem : undefined, dirty: !!saved.dirty });
        }
      } catch {
        // Storage unavailable or corrupt: start from the example.
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time flag after reading browser storage
    setRestored(true);
  }, [initialGraph]);

  // Autosave the working copy in this browser.
  useEffect(() => {
    if (!restored) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          AUTOSAVE_KEY,
          JSON.stringify({ graph: state.graph, problem: state.problem, dirty: state.dirty }),
        );
      } catch {
        // ignore quota / privacy-mode errors
      }
    }, 300);
    return () => clearTimeout(t);
  }, [state.graph, state.problem, state.dirty, restored]);

  // The “Change length” and “Change h(n)” tools; at most one is open at a time.
  const marks = useSessionMarks();
  const lengthTool = useLengthTool(state, dispatch, marks);
  const hTool = useHTool(state, dispatch, marks);
  const overlay = lengthTool.overlay ?? hTool.overlay;
  const toolActive = !!overlay;
  const { close: closeLength, start: beginLength } = lengthTool;
  const { close: closeH, start: beginH } = hTool;
  const closeTools = useCallback(() => {
    closeLength();
    closeH();
  }, [closeLength, closeH]);
  // Bring the tool's panel into view when it opens (the h table is far down the sidebar).
  const [reveal, setReveal] = useState(0);
  useEffect(() => {
    if (reveal) document.getElementById("tool-section")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [reveal]);
  const startLength = useCallback(
    (edgeId: string, length: number) => {
      closeH();
      beginLength(edgeId, length);
      setSheetOpen(true);
      setReveal((r) => r + 1);
    },
    [closeH, beginLength],
  );
  const startH = useCallback(
    (nodeId: string, h: number) => {
      closeLength();
      dispatch({ type: "select", selection: { kind: "node", id: nodeId } });
      beginH(nodeId, h);
      setSheetOpen(true);
      setReveal((r) => r + 1);
    },
    [closeLength, beginH],
  );

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextEntry(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (toolActive) {
        // The canvas belongs to the open tool; only Esc (cancel) applies.
        if (k === "escape") closeTools();
        return;
      }
      if (k === "v") dispatch({ type: "setMode", mode: "select" });
      else if (k === "n") dispatch({ type: "setMode", mode: "add-node" });
      else if (k === "e") dispatch({ type: "setMode", mode: "add-edge" });
      else if (k === "escape") {
        dispatch({ type: "setPendingEdge", from: null });
        dispatch({ type: "select", selection: null });
      } else if (k === "delete" || k === "backspace") {
        e.preventDefault();
        dispatch({ type: "deleteSelection" });
      } else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toolActive, closeTools]);

  const evaluated = useMemo(() => evaluateGraph(state.graph), [state.graph]);
  const heuristic = useMemo(
    () => (state.graph.nodes.length ? computeHeuristicTable(state.graph, state.problem, evaluated) : null),
    [state.graph, state.problem, evaluated],
  );
  // Rendered synchronously so the name field is focused within the tap/double-click event itself;
  // iOS only opens the keyboard for focus() calls made during a user gesture.
  const onRequestRename = useCallback((id: string) => {
    flushSync(() => {
      dispatch({ type: "select", selection: { kind: "node", id } });
      setRenameRequest(id);
      setSheetOpen(true);
    });
  }, []);
  const onRenameHandled = useCallback(() => setRenameRequest(null), []);

  // The canvas shows the open tool's proposal (new positions, costs and h) before it is applied.
  const preview = lengthTool.proposal?.positions ?? hTool.previewPositions;
  const display = useMemo(() => {
    if (!preview) return { state, evaluated, heuristic };
    const graph = { ...state.graph, nodes: state.graph.nodes.map((n) => (preview[n.id] ? { ...n, ...preview[n.id] } : n)) };
    const ev = evaluateGraph(graph);
    return {
      state: { ...state, graph },
      evaluated: ev,
      heuristic: graph.nodes.length ? computeHeuristicTable(graph, state.problem, ev) : null,
    };
  }, [preview, state, evaluated, heuristic]);

  const shared = { state, dispatch, evaluated };
  const selectionTitle =
    state.selection?.kind === "node" ? "State" : state.selection?.kind === "edge" ? "Action (edge)" : "Selection";
  const selectionSummary = lengthTool.title ?? hTool.title ?? summarize(state);

  return (
    <div className={styles.shell}>
      <Toolbar state={state} dispatch={dispatch} showH={showH} setShowH={setShowH} snap={snap} setSnap={setSnap} />
      <div className={styles.main}>
        <Canvas
          state={display.state}
          dispatch={dispatch}
          evaluated={display.evaluated}
          heuristic={display.heuristic}
          showH={showH}
          snap={snap}
          onRequestRename={onRequestRename}
          overlay={overlay}
        />
        <aside className={styles.sidebar} data-open={sheetOpen}>
          <button
            className={styles.sheetToggle}
            onClick={() => setSheetOpen((o) => !o)}
            aria-expanded={sheetOpen}
            aria-label={sheetOpen ? "Hide details panel" : "Show details panel"}
          >
            <span className={styles.sheetHandle} aria-hidden />
            <span className={styles.sheetTitle}>{selectionSummary}</span>
            <span aria-hidden>{sheetOpen ? "▾" : "▴"}</span>
          </button>
          {loadError && <p className={styles.error} style={{ padding: "10px 14px" }}>{loadError}</p>}
          {lengthTool.edit && (
            <Section id="tool-section" title="Change length">
              <LengthPanel
                tool={lengthTool}
                state={state}
                evaluated={evaluated}
                heuristic={heuristic}
                previewHeuristic={display.heuristic}
              />
            </Section>
          )}
          {hTool.edit && (
            <Section id="tool-section" title="Change h(n)">
              <HPanel tool={hTool} state={state} evaluated={evaluated} heuristic={heuristic} />
            </Section>
          )}
          <Section title={selectionTitle}>
            <Inspector
              {...shared}
              heuristic={heuristic}
              renameRequest={renameRequest}
              onRenameHandled={onRenameHandled}
              onRequestLength={startLength}
              onRequestH={startH}
            />
          </Section>
          <Section title="Problem & heuristic">
            <ProblemPanel
              state={state}
              dispatch={dispatch}
              heuristic={heuristic}
              onRequestH={startH}
              hSet={marks.hSet}
            />
          </Section>
          <Section title="Step costs & scale">
            <CostModelPanel {...shared} />
          </Section>
          <Section title="Transition model" open={false}>
            <TransitionPanel {...shared} />
          </Section>
          <Section title="Save & load">
            <StoragePanel {...shared} />
          </Section>
        </aside>
      </div>
    </div>
  );
}

/** One line for the collapsed bottom sheet: what is selected, or the problem. */
function summarize(state: EditorState): string {
  const { graph, problem, selection } = state;
  const name = (id: string | null) => graph.nodes.find((n) => n.id === id)?.name ?? "—";
  if (selection?.kind === "node") return `State ${name(selection.id)}`;
  if (selection?.kind === "edge") {
    const e = graph.edges.find((x) => x.id === selection.id);
    if (e) return `Action ${name(e.from)} ${e.directed ? "→" : "↔"} ${name(e.to)}`;
  }
  return `Details · ${name(problem.initial)} → ${name(problem.goal)}`;
}

/** Keyboard shortcuts are suppressed while typing, but not on checkboxes or buttons. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset", "file"].includes(target.type);
}

function Section({ id, title, open = true, children }: { id?: string; title: string; open?: boolean; children: ReactNode }) {
  return (
    <details id={id} className={styles.section} open={open}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}
