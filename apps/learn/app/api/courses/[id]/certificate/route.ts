import { type Params, route } from "@/lib/api";
import { certificate } from "@/lib/learn";

export const GET = route(async (me, _req, { params }: Params<"id">) => certificate(me, (await params).id));
