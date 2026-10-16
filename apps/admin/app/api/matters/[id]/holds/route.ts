import { body, route, type Params } from "@/lib/api";
import { createHold } from "@/lib/matters";

export const POST = route("compliance", async (me, req, { params }: Params<"id">) => createHold(me, (await params).id, await body(req)));
