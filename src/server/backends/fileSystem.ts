import "server-only";

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { StorageError, type Kind, type StorageBackend } from "./types";

/** Local files: data/graphs/<id>.json and data/problems/<id>.json. */
export function fileSystemBackend(dataDir: string): StorageBackend {
  const fileFor = (kind: Kind, id: string) => path.join(dataDir, kind, `${id}.json`);

  return {
    async read(kind, id) {
      try {
        return await readFile(fileFor(kind, id), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },

    async write(kind, id, text) {
      const file = fileFor(kind, id);
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(tmp, text, "utf8");
        await rename(tmp, file); // atomic replace
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EROFS" || code === "EACCES")
          throw new StorageError(
            "The server's file system is read-only. On Vercel, connect a Blob store to the project (see README).",
          );
        throw err;
      }
    },

    async list(kind) {
      try {
        const files = await readdir(path.join(dataDir, kind));
        return files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
    },

    async remove(kind, id) {
      await rm(fileFor(kind, id), { force: true });
    },
  };
}
