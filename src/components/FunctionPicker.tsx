"use client";

import { useState } from "react";
import type { FunctionRef } from "@/model/schema";
import FunctionEditor from "./FunctionEditor";
import styles from "./Editor.module.css";

const USER = "__user__";

interface Option {
  id: string;
  label: string;
  description: string;
}

interface Props {
  label: string;
  options: Option[];
  value: FunctionRef;
  onChange: (ref: FunctionRef) => void;
  /** For user functions. */
  signature: string;
  params: readonly string[];
  template: string;
  runtimeError?: string;
}

/**
 * Choose between registered built-in functions and a user-defined one.
 * Used for both cost models and heuristics, which makes them interchangeable in the UI.
 */
export default function FunctionPicker({ label, options, value, onChange, signature, params, template, runtimeError }: Props) {
  // Remember the last user function so toggling to a built-in and back doesn't lose it.
  const [lastUser, setLastUser] = useState<FunctionRef & { kind: "user" }>(
    value.kind === "user" ? value : { kind: "user", name: "custom", source: template },
  );
  if (value.kind === "user" && value !== lastUser && (value.source !== lastUser.source || value.name !== lastUser.name))
    setLastUser(value);

  const selected = value.kind === "user" ? USER : value.id;
  const description =
    value.kind === "user" ? "Your own function, written below." : options.find((o) => o.id === value.id)?.description;

  return (
    <>
      <label className={styles.field}>
        <span>{label}</span>
        <select
          value={selected}
          onChange={(e) => onChange(e.target.value === USER ? lastUser : { kind: "builtin", id: e.target.value })}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
          <option value={USER}>Custom function…</option>
        </select>
      </label>
      {description && <p className={styles.muted}>{description}</p>}
      {value.kind === "user" && (
        <FunctionEditor
          key={`${value.name}\u0000${value.source}`}
          signature={signature}
          params={params}
          name={value.name}
          source={value.source}
          runtimeError={runtimeError}
          onApply={(name, source) => onChange({ kind: "user", name, source })}
        />
      )}
    </>
  );
}
