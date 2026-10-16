import Link from "next/link";
import { Suspense } from "react";
import { listGraphs, listProblems } from "@/server/storage";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1>State-Space Editor</h1>
        <p>
          Draw state-space graphs for classical search in fully observable, deterministic, known environments: atomic
          states, actions with step costs, and problems with an initial state, a goal and heuristic values.
        </p>
        <div className={styles.actions}>
          <Link href="/editor" className={styles.primary}>
            Open editor
          </Link>
        </div>
      </header>
      <Suspense fallback={<p>Loading saved files…</p>}>
        <SavedFiles />
      </Suspense>
      <section className={styles.card}>
        <h2>HTTP API</h2>
        <ul>
          <li>
            <code>GET /api</code> – index of stored graphs and problems
          </li>
          <li>
            <code>GET /api/graphs/&lt;id&gt;</code> – graph JSON incl. derived edge costs and <code>ACTIONS(s)</code>
          </li>
          <li>
            <code>GET /api/problems/&lt;id&gt;</code> – problem JSON incl. heuristic table <code>h</code>
          </li>
        </ul>
        <p className={styles.muted}>
          Add <code>?download=1</code> to download as a file. Files are stored in <code>data/</code> on the server.
        </p>
      </section>
    </main>
  );
}

/** Server Component: reads the file store directly. */
async function SavedFiles() {
  const [graphs, problems] = await Promise.all([listGraphs(), listProblems()]);
  return (
    <div className={styles.grid}>
      <section className={styles.card}>
        <h2>Graphs ({graphs.length})</h2>
        {graphs.length === 0 ? (
          <p className={styles.muted}>No graphs saved yet. Open the editor and use “Save &amp; load”.</p>
        ) : (
          <ul className={styles.list}>
            {graphs.map((g) => (
              <li key={g.id}>
                <Link href={`/editor?graph=${encodeURIComponent(g.id)}`}>{g.name}</Link>
                <code>{g.id}</code>
                {g.updatedAt && <time dateTime={g.updatedAt}>{g.updatedAt.slice(0, 16).replace("T", " ")}</time>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.card}>
        <h2>Problems ({problems.length})</h2>
        {problems.length === 0 ? (
          <p className={styles.muted}>No problems saved yet.</p>
        ) : (
          <ul className={styles.list}>
            {problems.map((p) => (
              <li key={p.id}>
                <Link href={`/editor?problem=${encodeURIComponent(p.id)}`}>{p.name}</Link>
                <code>{p.id}</code>
                {p.graphId && <span className={styles.muted}>graph: {p.graphId}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
