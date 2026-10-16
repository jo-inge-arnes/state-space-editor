"use server";

import { revalidatePath } from "next/cache";
import * as storage from "@/server/storage";

export type ActionResult = { ok: true; id: string } | { ok: false; error: string };

async function run(fn: () => Promise<string>): Promise<ActionResult> {
  try {
    const id = await fn();
    revalidatePath("/");
    return { ok: true, id };
  } catch (err) {
    // Only surface validation messages; hide unexpected internals.
    if (err instanceof storage.StorageError) return { ok: false, error: err.message };
    console.error(err);
    return { ok: false, error: "Could not save on the server." };
  }
}

/** Save a graph document (validated server-side). */
export async function saveGraph(doc: unknown): Promise<ActionResult> {
  return run(async () => (await storage.writeGraph(doc)).id);
}

/** Save a problem document (validated server-side). */
export async function saveProblem(doc: unknown): Promise<ActionResult> {
  return run(async () => (await storage.writeProblem(doc)).id);
}

export async function deleteGraph(id: string): Promise<ActionResult> {
  return run(async () => {
    await storage.deleteGraph(id);
    return id;
  });
}

export async function deleteProblem(id: string): Promise<ActionResult> {
  return run(async () => {
    await storage.deleteProblem(id);
    return id;
  });
}
