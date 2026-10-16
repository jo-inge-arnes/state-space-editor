import { z } from "zod";

/** Ids used for stored files and graph elements: safe as file names. */
export const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const id = z.string().regex(ID_PATTERN, "Invalid id (allowed: letters, digits, - and _)");

export const stateNodeSchema = z.object({
  id,
  name: z.string().min(1).max(100),
  x: z.number().finite(),
  y: z.number().finite(),
});

export const edgeSchema = z.object({
  id,
  from: id,
  to: id,
  directed: z.boolean().default(false),
  /** Multiplier ≥ 1 applied by the Euclidean cost model. */
  friction: z.number().finite().min(1).default(1),
  /** Cost used by the manual cost model. */
  manualCost: z.number().finite().min(0).optional(),
});

/** Reference to a built-in function (registry id) or a user-written function body. */
export const functionRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("builtin"), id: z.string().min(1) }),
  z.object({
    kind: z.literal("user"),
    name: z.string().min(1).max(100),
    source: z.string().max(20_000),
  }),
]);

const graphFields = {
  version: z.literal(1),
  id,
  name: z.string().min(1).max(200),
  /** Scale: how many canvas pixels make up one distance unit. */
  pxPerUnit: z.number().finite().positive(),
  costModel: functionRefSchema,
  nodes: z.array(stateNodeSchema),
  edges: z.array(edgeSchema),
};

function checkGraphReferences(
  g: { nodes: { id: string }[]; edges: { id: string; from: string; to: string }[] },
  ctx: z.RefinementCtx,
) {
  const nodeIds = new Set<string>();
  for (const n of g.nodes) {
    if (nodeIds.has(n.id)) ctx.addIssue({ code: "custom", message: `Duplicate node id "${n.id}"` });
    nodeIds.add(n.id);
  }
  const edgeIds = new Set<string>();
  for (const e of g.edges) {
    if (edgeIds.has(e.id)) ctx.addIssue({ code: "custom", message: `Duplicate edge id "${e.id}"` });
    edgeIds.add(e.id);
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to))
      ctx.addIssue({ code: "custom", message: `Edge "${e.id}" references a missing node` });
    if (e.from === e.to) ctx.addIssue({ code: "custom", message: `Edge "${e.id}" is a self-loop` });
  }
}

export const graphSchema = z.object(graphFields).superRefine(checkGraphReferences);

const problemFields = {
  version: z.literal(1),
  id,
  name: z.string().min(1).max(200),
  graphId: id,
  initial: id.nullable(),
  goal: id.nullable(),
  heuristic: functionRefSchema,
  /** Per-node values used by the manual heuristic. */
  manualH: z.record(z.string(), z.number().finite()).default({}),
};

export const problemSchema = z.object(problemFields);

// ---------------------------------------------------------------------------
// File documents: the core data plus derived values (costs, actions, h-table)
// computed by the editor, for consumers such as search algorithm code.
// Derived values are recomputed on load and never trusted as source of truth.

const nullableNumber = z.number().finite().nullable();

export const graphDerivedSchema = z.object({
  costModel: z.string(),
  edges: z.array(
    z.object({ id, length: z.number().finite(), cost: nullableNumber, reverseCost: nullableNumber.optional() }),
  ),
  actions: z.record(z.string(), z.array(z.object({ action: z.string(), to: id, cost: nullableNumber }))),
});

export const graphDocumentSchema = z
  .object({ ...graphFields, derived: graphDerivedSchema.optional() })
  .superRefine(checkGraphReferences);

export const problemDerivedSchema = z.object({
  heuristic: z.string(),
  /** Estimated cost to the goal h(n) per node id. */
  h: z.record(z.string(), nullableNumber),
});

export const problemDocumentSchema = z.object({
  ...problemFields,
  derived: problemDerivedSchema.optional(),
  /** Embedded graph, making a problem file self-contained. */
  graph: graphDocumentSchema.optional(),
});

export type GraphDocument = z.infer<typeof graphDocumentSchema>;
export type ProblemDocument = z.infer<typeof problemDocumentSchema>;

export type StateNode = z.infer<typeof stateNodeSchema>;
export type Edge = z.infer<typeof edgeSchema>;
export type FunctionRef = z.infer<typeof functionRefSchema>;
export type StateSpaceGraph = z.infer<typeof graphSchema>;
export type Problem = z.infer<typeof problemSchema>;

/** Readable one-line summary of a zod error. */
export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}

/** Replace characters not allowed in ids while typing (keeps dashes where typed). */
export function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
}

/** Turn a display name into a storage id. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "untitled";
}
