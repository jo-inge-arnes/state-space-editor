import "server-only";

import { StorageError } from "./storage";

/** JSON response for a stored document; ?download=1 makes browsers save it as a file. */
export async function documentResponse(
  request: Request,
  id: string,
  read: (id: string) => Promise<unknown | null>,
): Promise<Response> {
  try {
    const doc = await read(id);
    if (doc === null) return Response.json({ error: "Not found" }, { status: 404 });
    const download = new URL(request.url).searchParams.has("download");
    return new Response(JSON.stringify(doc, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        ...(download ? { "content-disposition": `attachment; filename="${id}.json"` } : {}),
      },
    });
  } catch (err) {
    if (err instanceof StorageError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
