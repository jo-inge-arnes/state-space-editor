import { documentResponse } from "@/server/routeHelpers";
import { readProblem } from "@/server/storage";

export async function GET(request: Request, ctx: RouteContext<"/api/problems/[id]">) {
  const { id } = await ctx.params;
  return documentResponse(request, id, readProblem);
}
