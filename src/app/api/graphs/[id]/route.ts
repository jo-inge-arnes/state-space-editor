import { documentResponse } from "@/server/routeHelpers";
import { readGraph } from "@/server/storage";

export async function GET(request: Request, ctx: RouteContext<"/api/graphs/[id]">) {
  const { id } = await ctx.params;
  return documentResponse(request, id, readGraph);
}
