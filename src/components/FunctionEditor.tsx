"use client";

import { useState, type KeyboardEvent } from "react";
import { compileUserFunction } from "@/model/userFunctions";
import styles from "./Editor.module.css";

interface Props {
  /** Shown above the editor, e.g. "(edge, from, to, ctx) => number". */
  signature: string;
  params: readonly string[];
  name: string;
  source: string;
  /** Runtime problem reported by the caller after applying (e.g. "2 actions failed"). */
  runtimeError?: string;
  onApply: (name: string, source: string) => void;
}

/**
 * Editor for a user-defined function body. Code only runs when "Apply" is
 * pressed, so half-typed code (or an accidental infinite loop) doesn't run on every keystroke.
 */
export default function FunctionEditor({ signature, params, name, source, runtimeError, onApply }: Props) {
  const [draftName, setDraftName] = useState(name);
  const [draft, setDraft] = useState(source);
  const [compileError, setCompileError] = useState<string | null>(null);
  const changed = draft !== source || draftName !== name;

  const apply = () => {
    const compiled = compileUserFunction(params, draft);
    if (!compiled.ok) return setCompileError(compiled.error);
    setCompileError(null);
    onApply(draftName.trim() || "custom", draft);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: end } = el;
      const next = draft.slice(0, s) + "  " + draft.slice(end);
      setDraft(next);
      requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      apply();
    }
  };

  return (
    <div className={styles.sectionBody} style={{ padding: 0 }}>
      <label className={styles.field}>
        <span>Function name</span>
        <input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
      </label>
      <div className={styles.signature}>function {signature} {"{"}</div>
      <textarea
        className={styles.code}
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Function body"
      />
      <div className={styles.signature}>{"}"}</div>
      <div className={styles.row}>
        <button className="primary" onClick={apply} disabled={!changed && !compileError}>
          Apply
        </button>
        <span className={styles.muted}>
          <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to apply
        </span>
      </div>
      {compileError && <p className={styles.error}>{compileError}</p>}
      {!compileError && runtimeError && <p className={styles.error}>{runtimeError}</p>}
      <p className={styles.muted}>Runs in your browser only; the server stores the code as text.</p>
    </div>
  );
}
