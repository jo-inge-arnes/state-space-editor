"use client";

import Link from "next/link";
import type { Dispatch } from "react";
import { slugify } from "@/model/schema";
import type { EditorAction, EditorState, Mode } from "@/state/editorReducer";
import styles from "./Editor.module.css";

const MODES: { mode: Mode; label: string; key: string }[] = [
  { mode: "select", label: "Select / move", key: "V" },
  { mode: "add-node", label: "Add state", key: "N" },
  { mode: "add-edge", label: "Add action", key: "E" },
];

interface Props {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  showH: boolean;
  setShowH: (v: boolean) => void;
  snap: boolean;
  setSnap: (v: boolean) => void;
}

export default function Toolbar({ state, dispatch, showH, setShowH, snap, setSnap }: Props) {
  const { graph, mode, selection, dirty } = state;

  const rename = (name: string) => {
    // Keep the file id in sync with the name until the user customises it.
    const followId = graph.id === slugify(graph.name);
    dispatch({ type: "setGraphMeta", patch: followId ? { name, id: slugify(name) } : { name } });
  };

  return (
    <header className={styles.toolbar}>
      <Link href="/" className={styles.brand}>
        State-Space Editor
      </Link>
      <input
        aria-label="Graph name"
        value={graph.name}
        onChange={(e) => rename(e.target.value)}
        style={{ width: 180 }}
      />
      {dirty && <span className={styles.dirty}>● unsaved</span>}
      <span className={styles.sep} />
      <div className={styles.group} role="group" aria-label="Tool">
        {MODES.map((m) => (
          <button
            key={m.mode}
            className={mode === m.mode ? styles.modeActive : undefined}
            aria-pressed={mode === m.mode}
            onClick={() => dispatch({ type: "setMode", mode: m.mode })}
            title={`${m.label} (${m.key})`}
          >
            {m.label} <kbd>{m.key}</kbd>
          </button>
        ))}
      </div>
      <button className="danger" disabled={!selection} onClick={() => dispatch({ type: "deleteSelection" })}>
        Delete
      </button>
      <span className={styles.sep} />
      <label className={styles.toggle}>
        <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
        Snap to grid
      </label>
      <label className={styles.toggle}>
        <input type="checkbox" checked={showH} onChange={(e) => setShowH(e.target.checked)} />
        Show h(n)
      </label>
      <span className={styles.spacer} />
      <button
        onClick={() => {
          if (!dirty || confirm("Start a new graph? Unsaved changes will be lost.")) dispatch({ type: "new" });
        }}
      >
        New graph
      </button>
    </header>
  );
}
