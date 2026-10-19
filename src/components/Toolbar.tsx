"use client";

import Link from "next/link";
import type { Dispatch } from "react";
import { slugify } from "@/model/schema";
import type { EditorAction, EditorState, Mode } from "@/state/editorReducer";
import styles from "./Editor.module.css";

const MODES: { mode: Mode; label: string; short: string; key: string }[] = [
  { mode: "select", label: "Select / move", short: "Move", key: "V" },
  { mode: "add-node", label: "Add state", short: "+State", key: "N" },
  { mode: "add-edge", label: "Add action", short: "+Action", key: "E" },
];

/** Full label on wide screens, short one on phones (switched in CSS). */
function Label({ long, short }: { long: string; short: string }) {
  return (
    <>
      <span className={styles.long}>{long}</span>
      <span className={styles.short}>{short}</span>
    </>
  );
}

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
      <Link href="/" className={styles.brand} title="Home: saved graphs and problems">
        <Label long="State-Space Editor" short="⌂" />
      </Link>
      <input
        aria-label="Graph name"
        className={styles.nameInput}
        value={graph.name}
        onChange={(e) => rename(e.target.value)}
      />
      {dirty && (
        <span className={styles.dirty} title="Unsaved changes">
          ● <span className={styles.long}>unsaved</span>
        </span>
      )}
      <button
        className={styles.newNarrow}
        onClick={() => {
          if (!dirty || confirm("Start a new graph? Unsaved changes will be lost.")) dispatch({ type: "new" });
        }}
      >
        New
      </button>
      <span className={`${styles.sep} ${styles.lineBreak}`} />
      <div className={styles.group} role="group" aria-label="Tool">
        {MODES.map((m) => (
          <button
            key={m.mode}
            className={mode === m.mode ? styles.modeActive : undefined}
            aria-pressed={mode === m.mode}
            onClick={() => dispatch({ type: "setMode", mode: m.mode })}
            title={`${m.label} (${m.key})`}
          >
            <Label long={m.label} short={m.short} /> <kbd className={styles.long}>{m.key}</kbd>
          </button>
        ))}
      </div>
      <button
        className="danger"
        disabled={!selection}
        onClick={() => dispatch({ type: "deleteSelection" })}
        aria-label="Delete selection"
        title="Delete selection (Del)"
      >
        <Label long="Delete" short="🗑" />
      </button>
      <span className={styles.sep} />
      <label className={styles.toggle}>
        <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
        <Label long="Snap to grid" short="Snap" />
      </label>
      <label className={styles.toggle}>
        <input type="checkbox" checked={showH} onChange={(e) => setShowH(e.target.checked)} />
        <Label long="Show h(n)" short="h(n)" />
      </label>
      <span className={styles.spacer} />
      <button
        className={styles.newWide}
        onClick={() => {
          if (!dirty || confirm("Start a new graph? Unsaved changes will be lost.")) dispatch({ type: "new" });
        }}
      >
        New graph
      </button>
    </header>
  );
}
