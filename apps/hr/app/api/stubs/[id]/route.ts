import { type Params, vroute } from "@/lib/api";
import { getStub } from "@/lib/payroll/runs";

export const GET = vroute(async (v, _req, { params }: Params<"id">) => getStub(v, (await params).id));
