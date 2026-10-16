import "server-only";

import path from "node:path";
import { connection } from "next/server";
import {
  formatZodError,
  graphDocumentSchema,
  ID_PATTERN,
  problemDocumentSchema,
  type GraphDocument,
  type ProblemDocument,
} from "@/model/schema";
import type { StoredEntry } from "@/model/storageTypes";
import { fileSystemBackend } from "./backends/fileSystem";
import { StorageError, type Kind, type StorageBackend } from "./backends/types";
import { vercelBlobBackend } from "./backends/vercelBlob";

/**
 * JSON document store for graphs and problems. Documents hold the full data
 * (core + derived values). User-defined function sources are stored as text
 * only and never executed on the server.
 *
 * Backend: Vercel Blob when a Blob store is connected (as on Vercel, whose file
 * system is read-only), otherwise local files in ./data.
 */
const backend: StorageBackend = blobConfigured()
  ? vercelBlobBackend(process.env.STATE_SPACE_BLOB_ACCESS === "public" ? "public" : "private")
  : // Runtime data, not part of the build output (hence the turbopackIgnore hint).
    fileSystemBackend(process.env.STATE_SPACE_DATA_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "data"));

function blobConfigured(): boolean {
  const choice = process.env.STATE_SPACE_STORAGE;
  if (choice === "blob") return true;
  if (choice === "fs") return false;
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

export type { StoredEntry };
export { StorageError };

function checkId(id: string): string {
  if (!ID_PATTERN.test(id)) throw new StorageError(`Invalid id "${id}"`);
  return id;
}

async function readJson(kind: Kind, id: string): Promise<unknown | null> {
  await connection(); // always read fresh at request time
  const text = await backend.read(kind, checkId(id));
  return text === null ? null : JSON.parse(text);
}

async function writeJson(kind: Kind, id: string, data: unknown): Promise<void> {
  await backend.write(kind, checkId(id), JSON.stringify(data, null, 2) + "\n");
}

async function list(kind: Kind): Promise<StoredEntry[]> {
  await connection();
  const ids = (await backend.list(kind)).filter((id) => ID_PATTERN.test(id));
  const entries = await Promise.all(
    ids.map(async (id): Promise<StoredEntry | null> => {
      try {
        const text = await backend.read(kind, id);
        if (text === null) return null;
        const raw = JSON.parse(text);
        return {
          id: String(raw.id ?? id),
          name: String(raw.name ?? raw.id ?? id),
          updatedAt: String(raw.updatedAt ?? ""),
          ...(raw.graphId ? { graphId: String(raw.graphId) } : {}),
        };
      } catch {
        return null; // skip unreadable files
      }
    }),
  );
  return entries.filter((e) => e !== null).sort((a, b) => a.name.localeCompare(b.name));
}

export const listGraphs = () => list("graphs");
export const listProblems = () => list("problems");

export async function readGraph(id: string): Promise<GraphDocument | null> {
  const raw = await readJson("graphs", id);
  if (raw === null) return null;
  const r = graphDocumentSchema.safeParse(raw);
  if (!r.success) throw new StorageError(`Stored graph "${id}" is invalid: ${formatZodError(r.error)}`);
  return r.data;
}

export async function readProblem(id: string): Promise<ProblemDocument | null> {
  const raw = await readJson("problems", id);
  if (raw === null) return null;
  const r = problemDocumentSchema.safeParse(raw);
  if (!r.success) throw new StorageError(`Stored problem "${id}" is invalid: ${formatZodError(r.error)}`);
  return r.data;
}

export async function writeGraph(input: unknown): Promise<GraphDocument> {
  const r = graphDocumentSchema.safeParse(input);
  if (!r.success) throw new StorageError(`Invalid graph: ${formatZodError(r.error)}`);
  await writeJson("graphs", r.data.id, { ...r.data, updatedAt: new Date().toISOString() });
  return r.data;
}

export async function writeProblem(input: unknown): Promise<ProblemDocument> {
  const r = problemDocumentSchema.safeParse(input);
  if (!r.success) throw new StorageError(`Invalid problem: ${formatZodError(r.error)}`);
  // Problems on the server reference their graph by id instead of embedding it.
  const { graph: _embedded, ...problem } = r.data;
  void _embedded;
  await writeJson("problems", problem.id, { ...problem, updatedAt: new Date().toISOString() });
  return problem;
}

export async function deleteGraph(id: string): Promise<void> {
  await backend.remove("graphs", checkId(id));
}

export async function deleteProblem(id: string): Promise<void> {
  await backend.remove("problems", checkId(id));
}
