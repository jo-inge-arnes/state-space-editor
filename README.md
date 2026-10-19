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

## Changing an edge's length

Select an edge and type a new **Length**. The editor then moves states so that **as few other edges as possible
change length**:

1. **Lock edges first.** The panel lists the edges that could be affected (the other edges in the edited edge's
   biconnected block, nearest first). Tick the ones that must keep their length, or click them on the canvas. Choices
   are remembered for the session, and edges whose length you set earlier start out locked.
2. **Compute.** The result shows which other edges change, which states move and how (e.g. “A rotates 11.2° clockwise
   about C”). The canvas previews the new layout, with dashed circles at the current positions. Browse the alternatives
   with ◀ ▶: fewest moved states first, then a least-total-movement layout.
3. **Apply** (and **Undo** if needed).

If locked edges make the change impossible, the panel names them. If the length is out of reach (e.g. longer than a
fully stretched chain), the panel offers the closest reachable length.

How it works (`src/model/layout/`):

- **Localise** (`structure.ts`): only edges in the edited edge's biconnected block can need to change. Everything else
  hangs off a single state and follows along rigidly.
- **Fewest changed edges** (`pebbleGame.ts`, `release.ts`):
  - By Laman's theorem for 2D generic rigidity, an edge's length can change while a set of other edges keep theirs iff
    it is independent of them in the rigidity matroid. This covers every length-preserving motion: rotation about a
    neighbour, rigid rotation or translation of a group, and linkage flexes.
  - The *release set* (edges allowed to change) is therefore a minimum hitting set of the circuits through the edge.
  - It is found by iterative deepening, branching on the rigid region reported by a failed (2,3) pebble-game test
    (Jacobs & Hendrickson). Each candidate is checked incrementally: clone, remove the released bars, and re-insert
    the redundant ones.
  - With a time budget, it falls back to a greedy choice and is flagged as not proven minimal.
- **Fewest moved states** (`movers.ts`, `solver.ts`):
  - From each end of the edge, a set of moving states grows by adding the neighbour that adds the most freedom. Once
    the rigidity matrix at generic positions says the length is free, the solver tries the motion.
  - The solver is a damped Gauss–Newton continuation with minimum-norm steps. It steps the target length and follows
    the continuous motion instead of flipping to a mirror image.
  - If the solver stops short (out of range), the set grows. If every candidate is out of range, the most resisting
    edge is released.

Typical graphs take a few milliseconds; the panel shows the time and the number of rigidity tests.

## Setting h(n) by moving a state

Type a new value for a state's **h(n)**, either in the state inspector or in the h table under *Problem & heuristic*.
The editor then moves that state until the problem's *actual* heuristic has that value: straight-line, Manhattan, or
your own function, including functions that read costs from `ctx.actions`.

- **Keep the length of:** choose one of the state's edges (or click it on the canvas). The state rotates about the
  other end on a fixed radius, shown as a dashed circle, so that edge's length and cost stay the same. Only this state
  moves, so its other edges change length; they are listed.
  - *any edge* tries every edge (and *no edge*) and ranks the results. Edges whose length you set earlier are kept
    where possible.
  - *no edge* moves the state in a straight line in the direction where h changes fastest.
- The result shows the rotation (e.g. “A rotates 24.7° clockwise about C, keeping A – C”), the changed edges, any
  other h values that change (custom heuristics may depend on other states), and alternatives with ◀ ▶.
  - If the value is out of reach, the panel shows the range h can take and offers the closest value.
- **Override instead:** the panel's first option just sets the value, without moving anything. It replaces whatever
  the heuristic computes for that state. This works for every heuristic, and is the only option for the zero heuristic,
  for the goal's own h, and where the heuristic fails.
  - Overrides are saved in the problem's `hOverrides`, and the exported `derived.h` table includes them.
  - They are marked ✎ in the h table and on the canvas. Click ✎× to use the heuristic's value again; typing into an
    overridden value just changes the override.
- Manual heuristics are edited directly, as before.
- States whose h you set are marked in the h table. The length tool then keeps them in place by default and lists any
  h values its proposal would change.

How it works (`src/model/layout/adjustH.ts`): h is treated as a black box and evaluated through the same context as the
h table. Moving along a circle (or a ray) is a 1-D problem:
1. Sample 720 positions.
2. Bracket each sign change of h − target and refine it by bisection.
3. Accept a root only where h really equals the target, so a jump in a discontinuous function isn't mistaken for a
   solution.

Positions where the heuristic throws are skipped.

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
src/model/layout/ edge-length adjustment (blocks, pebble game, release search, solver) and h targets (adjustH)
src/state/        editor reducer
src/components/   client components: Canvas (SVG), Inspector, panels, FunctionEditor
src/server/       storage (server-only): file-system and Vercel Blob backends
src/app/          pages (Server Components), Server Actions, Route Handlers
```
