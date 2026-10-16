import { type Params, vroute } from "@/lib/api";
import { w2Document } from "@/lib/payroll/yearend";

export const GET = vroute(async (v, req, { params }: Params<"id">) => w2Document(v, (await params).id, new URL(req.url).searchParams.get("year")));
