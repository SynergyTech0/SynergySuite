import { body, vroute } from "@/lib/api";
import { listChecklists, startChecklist } from "@/lib/hr";

export const GET = vroute(async (v, req) => listChecklists(v, new URL(req.url).searchParams.get("employee") ?? undefined));
export const POST = vroute(async (v, req) => startChecklist(v, await body(req)));
