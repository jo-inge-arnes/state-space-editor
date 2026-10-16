import "server-only";

import { BlobError, del, get, list, put, type BlobAccessType } from "@vercel/blob";
import { StorageError, type Kind, type StorageBackend } from "./types";

/**
 * Vercel Blob store: blobs named graphs/<id>.json and problems/<id>.json.
 * Credentials come from the environment variables Vercel sets when a Blob store
 * is connected to the project (BLOB_READ_WRITE_TOKEN, or OIDC + BLOB_STORE_ID).
 */
export function vercelBlobBackend(access: BlobAccessType): StorageBackend {
  const pathFor = (kind: Kind, id: string) => `${kind}/${id}.json`;

  return {
    read: (kind, id) =>
      wrap(async () => {
        // useCache: false so a document is read back right after it was saved.
        const result = await get(pathFor(kind, id), { access, useCache: false });
        if (!result || result.statusCode !== 200) return null;
        return await new Response(result.stream).text();
      }),

    write: (kind, id, text) =>
      wrap(async () => {
        await put(pathFor(kind, id), text, {
          access,
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: true,
        });
      }),

    list: (kind) =>
      wrap(async () => {
        const prefix = `${kind}/`;
        const ids: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await list({ prefix, cursor });
          for (const blob of page.blobs)
            if (blob.pathname.endsWith(".json")) ids.push(blob.pathname.slice(prefix.length, -".json".length));
          cursor = page.hasMore ? page.cursor : undefined;
        } while (cursor);
        return ids;
      }),

    remove: (kind, id) =>
      wrap(async () => {
        await del(pathFor(kind, id));
      }),
  };
}

/** Report Blob errors (missing store, bad token, …) to the user instead of a generic failure. */
async function wrap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BlobError) {
      const message = err.message.startsWith("Vercel Blob") ? err.message : `Vercel Blob: ${err.message}`;
      throw new StorageError(message);
    }
    throw err;
  }
}
