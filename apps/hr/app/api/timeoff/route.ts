import { body, vroute } from "@/lib/api";
import { listTimeOff, requestTimeOff } from "@/lib/hr";

export const GET = vroute(async (v, req) => {
  const p = new URL(req.url).searchParams;
  return listTimeOff(v, p.get("scope") ?? "mine", p.get("from") ?? undefined, p.get("to") ?? undefined);
});
export const POST = vroute(async (v, req) => requestTimeOff(v, await body(req)));
