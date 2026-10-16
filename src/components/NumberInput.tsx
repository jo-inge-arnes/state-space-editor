"use client";

import { useState, type InputHTMLAttributes } from "react";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: number | undefined;
  onCommit: (value: number) => void;
}

/**
 * Number field that keeps a text draft while typing and commits a parsed value
 * on blur / Enter, so intermediate input like "1." or "" doesn't fight the state.
 */
export default function NumberInput({ value, onCommit, min, ...rest }: Props) {
  const shown = value === undefined ? "" : String(Number(value.toFixed(4)));
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n) && (min === undefined || n >= Number(min))) onCommit(n);
    setDraft(null);
  };

  return (
    <input
      {...rest}
      type="number"
      inputMode="decimal"
      min={min}
      value={draft ?? shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
      style={{ width: 90, ...rest.style }}
    />
  );
}
