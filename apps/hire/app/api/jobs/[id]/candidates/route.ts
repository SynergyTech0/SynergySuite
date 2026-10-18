import { type Params, body, route } from "@/lib/api";
import { addCandidate, listCandidates } from "@/lib/hire";

export const GET = route(async (me, _req, { params }: Params<"id">) => listCandidates(me, (await params).id));
export const POST = route(async (me, req, { params }: Params<"id">) => addCandidate(me, (await params).id, await body(req)));
