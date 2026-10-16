import { type Params, body, vroute } from "@/lib/api";
import { getPrivate, savePrivate } from "@/lib/payroll/private";

export const GET = vroute(async (v, _req, { params }: Params<"id">) => getPrivate(v, (await params).id));
export const PUT = vroute(async (v, req, { params }: Params<"id">) => savePrivate(v, (await params).id, await body(req)));
