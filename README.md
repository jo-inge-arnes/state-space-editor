# State-Space Editor

A visual editor for state-space graphs for classical AI search in fully observable, deterministic, known environments.
Built with Next.js 16 (App Router, Cache Components), React 19 and TypeScript.

- **States** are nodes with atomic, editable names. **Actions** are edges (two-way by default, or one-way).
- **Step costs** come from a pluggable cost model: Euclidean length × friction (default), manual per-edge costs,
  unit cost, or your own JavaScript function.
- **Problems** are an initial state, a goal state and a pluggable **heuristic**: straight-line distance, Manhattan, zero,
  manual per-node values, or your own function. The editor shows the estimate h(n) for each state.
- **Scale:** `pxPerUnit` (default 100 px = 1 unit = one grid square). Euclidean costs and straight-line heuristics use
  the same units.

## Running

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests (Vitest)
npm run build && npm start
```

Locally, saved files are written to `data/graphs/*.json` and `data/problems/*.json` (change with `STATE_SPACE_DATA_DIR`).

## Deploying on Vercel

Vercel's server file system is read-only, so on Vercel the app stores files in **Vercel Blob** instead:

1. In the Vercel dashboard, open the project → **Storage** → **Create** → **Blob**, and connect the store to the project.
   Vercel then sets the store's credentials (`BLOB_READ_WRITE_TOKEN`) as environment variables.
2. Redeploy. The app uses Blob automatically whenever those credentials are present.

Files are kept as private blobs named `graphs/<id>.json` and `problems/<id>.json`.

| Variable | Effect |
| --- | --- |
| `STATE_SPACE_STORAGE` | `blob` or `fs` to force a backend (default: Blob if credentials exist, else files) |
| `STATE_SPACE_BLOB_ACCESS` | `private` (default) or `public`, matching your Blob store |
| `STATE_SPACE_DATA_DIR` | Folder for the file backend (default `./data`) |

To use the Blob store when running locally, run `vercel env pull .env.local` (Vercel CLI).

There is no login: anyone who can open the deployment can save, overwrite and delete files.

## Editor

| Key | Action |
| --- | --- |
| `V` | Select / move (drag states, drag background to pan, wheel to zoom) |
| `N` | Add states (click empty canvas) |
| `E` | Add actions (click source state, then target state) |
| `Del` | Delete selection |
| `Esc` | Cancel |
| Double-click a state | Rename |

On phones and tablets the side panel becomes a bottom sheet (tap its bar to open or close it). Touch controls: drag a
state to move it, drag empty canvas to pan (in every tool), pinch to zoom, tap with **+State** / **+Action** to add,
and double-tap a state to rename it.

## JSON files

Graph and problem files contain the core data plus a `derived` block computed by the editor, for search code to read
directly: edge `length`, `cost` / `reverseCost`, the `actions` map (`ACTIONS(s)` with costs), and for problems the
heuristic table `h` (estimated cost to the goal per state). On load, the editor ignores
`derived` and recomputes it. Exported problem files embed their graph; problems on the server reference it by `graphId`.

HTTP API: `GET /api` (index), `GET /api/graphs/<id>`, `GET /api/problems/<id>` (add `?download=1` to download).
Writes go through Server Actions in `src/app/actions.ts`.

## Adding cost models and heuristics

Users can write functions in the editor ("Custom function…"); the source is stored in the JSON and only executed in the
browser, never on the server.

To add a permanent built-in, add an object to `src/model/costs/builtins.ts` or `src/model/heuristics/builtins.ts` and
register it in the list in the matching `registry.ts`:

```ts
// src/model/heuristics/builtins.ts
export const halfStraightLine: Heuristic = {
  id: "half-straight-line",
  label: "½ straight-line",
  description: "Half the air distance to the goal.",
  h: (node, ctx) => ctx.euclidean(node, ctx.goal) / 2,
};
```

Everything (UI, export) goes through `computeHeuristicTable` / `evaluateGraph`, so new entries work everywhere.

## Layout

```
src/model/        schema (zod), geometry, cost models, heuristics, actions, serialization
src/state/        editor reducer
src/components/   client components: Canvas (SVG), Inspector, panels, FunctionEditor
src/server/       storage (server-only): file-system and Vercel Blob backends
src/app/          pages (Server Components), Server Actions, Route Handlers
```
