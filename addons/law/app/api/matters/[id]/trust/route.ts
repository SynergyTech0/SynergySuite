import { type Params, route } from "@/lib/api";
import { ledger } from "@/lib/trust";

export const GET = route(async (me, _req, { params }: Params<"id">) => ledger(me, { matterId: (await params).id }));
