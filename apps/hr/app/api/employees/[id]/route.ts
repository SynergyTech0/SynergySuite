import { type Params, body, vroute } from "@/lib/api";
import { getEmployee, updateEmployee } from "@/lib/hr";

export const GET = vroute(async (v, _req, { params }: Params<"id">) => getEmployee(v, (await params).id));
export const PATCH = vroute(async (v, req, { params }: Params<"id">) => updateEmployee(v, (await params).id, await body(req)));
