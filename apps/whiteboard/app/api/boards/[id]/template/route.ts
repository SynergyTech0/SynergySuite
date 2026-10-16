import { type Params, route } from "@/lib/api";
import * as boards from "@/lib/boards";

/** The template to lay out on a new board, handed to the first editor who asks (then none). */
export const POST = route(async (me, _req, { params }: Params<"id">) => ({ template: await boards.claimTemplate(me, (await params).id) }));
