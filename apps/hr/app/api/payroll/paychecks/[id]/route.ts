import { type Params, body, vroute } from "@/lib/api";
import { removePaycheck, updatePaycheck } from "@/lib/payroll/runs";

export const PATCH = vroute(async (v, req, { params }: Params<"id">) => updatePaycheck(v, (await params).id, await body(req)));
export const DELETE = vroute(async (v, _req, { params }: Params<"id">) => removePaycheck(v, (await params).id));
