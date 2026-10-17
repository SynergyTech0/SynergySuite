import { type Params, route } from "@/lib/api";
import { analyzeDocument } from "@/lib/documents";

export const POST = route(async (me, _req, { params }: Params<"id">) => analyzeDocument(me, (await params).id));
