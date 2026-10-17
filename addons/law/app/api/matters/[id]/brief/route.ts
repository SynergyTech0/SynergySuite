import { type Params, route } from "@/lib/api";
import { briefMatter } from "@/lib/documents";

export const POST = route(async (me, _req, { params }: Params<"id">) => briefMatter(me, (await params).id));
