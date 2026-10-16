import { type Params, body, vroute } from "@/lib/api";
import { endDeduction, updateDeduction } from "@/lib/payroll/runs";

export const PATCH = vroute(async (v, req, { params }: Params<"id">) => updateDeduction(v, (await params).id, await body(req)));
export const DELETE = vroute(async (v, _req, { params }: Params<"id">) => endDeduction(v, (await params).id));
