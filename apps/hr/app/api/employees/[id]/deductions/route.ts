import { type Params, body, vroute } from "@/lib/api";
import { addDeduction } from "@/lib/payroll/runs";

export const POST = vroute(async (v, req, { params }: Params<"id">) => addDeduction(v, (await params).id, await body(req)));
