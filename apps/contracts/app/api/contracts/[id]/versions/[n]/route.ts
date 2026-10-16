import { route, type Params } from "@/lib/api";
import { version } from "@/lib/contracts";

export const GET = route(async (me, _req, { params }: Params<"id" | "n">) => {
  const p = await params;
  return version(me, p.id, Number(p.n) || 0);
});
