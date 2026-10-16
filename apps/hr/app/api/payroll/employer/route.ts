import { body, vroute } from "@/lib/api";
import { getEmployer, saveEmployer } from "@/lib/payroll/employer";

export const GET = vroute(async (v) => getEmployer(v));
export const PUT = vroute(async (v, req) => saveEmployer(v, await body(req)));
