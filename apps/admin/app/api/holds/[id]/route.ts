import { body, route, type Params } from "@/lib/api";
import { updateHold } from "@/lib/matters";

export const PATCH = route("compliance", async (me, req, { params }: Params<"id">) => updateHold(me, (await params).id, await body(req)));
