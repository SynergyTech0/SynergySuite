import { body, route, type Params } from "@/lib/api";
import { save } from "@/lib/searches";

export const POST = route("compliance", async (me, req, { params }: Params<"id">) => save(me, (await params).id, await body(req)));
