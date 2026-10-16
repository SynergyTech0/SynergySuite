import { type Params, vroute } from "@/lib/api";
import { getRun } from "@/lib/payroll/runs";

export const GET = vroute(async (v, _req, { params }: Params<"id">) => getRun(v, (await params).id));
