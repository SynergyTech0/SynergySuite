import { type Params, body, vroute } from "@/lib/api";
import { getProfile, saveProfile } from "@/lib/payroll/runs";

export const GET = vroute(async (v, _req, { params }: Params<"id">) => getProfile(v, (await params).id));
export const PUT = vroute(async (v, req, { params }: Params<"id">) => saveProfile(v, (await params).id, await body(req)));
