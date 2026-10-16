import { body, vroute } from "@/lib/api";
import { createRun, listRuns } from "@/lib/payroll/runs";

export const GET = vroute(async (v) => listRuns(v));
export const POST = vroute(async (v, req) => createRun(v, await body(req)));
