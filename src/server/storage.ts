import "server-only";

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

/**
 * File-based JSON store: data/graphs/<id>.json and data/problems/<id>.json.
 * Files hold the full documents (core + derived values). User-defined function
 * sources are stored as text only and never executed on the server.
 */
// Runtime data, not part of the build output (hence the turbopackIgnore hint).
const DATA_DIR = process.env.STATE_SPACE_DATA_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "data");

type Kind = "graphs" | "problems";

export type { StoredEntry };

export class StorageError extends Error {}

function fileFor(kind: Kind, id: string): string {
  if (!ID_PATTERN.test(id)) throw new StorageError(`Invalid id "${id}"`);
  return path.join(DATA_DIR, kind, `${id}.json`);
}

async function readJson(kind: Kind, id: string): Promise<unknown | null> {
  await connection(); // always read fresh from disk at request time
  try {
    return JSON.parse(await readFile(fileFor(kind, id), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeJson(kind: Kind, id: string, data: unknown): Promise<void> {
  const file = fileFor(kind, id);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await rename(tmp, file); // atomic replace
}

async function list(kind: Kind): Promise<StoredEntry[]> {
  await connection();
  const dir = path.join(DATA_DIR, kind);
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const entries = await Promise.all(
    files.map(async (f): Promise<StoredEntry | null> => {
      try {
        const raw = JSON.parse(await readFile(path.join(dir, f), "utf8"));
        return {
          id: String(raw.id ?? f.replace(/\.json$/, "")),
          name: String(raw.name ?? raw.id ?? f),
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
  await rm(fileFor("graphs", id), { force: true });
}

export async function deleteProblem(id: string): Promise<void> {
  await rm(fileFor("problems", id), { force: true });
}
