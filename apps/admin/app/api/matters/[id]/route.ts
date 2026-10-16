import { body, route, type Params } from "@/lib/api";
import { detail, update } from "@/lib/matters";

export const GET = route("compliance", async (me, _req, { params }: Params<"id">) => detail(me, (await params).id));
export const PATCH = route("compliance", async (me, req, { params }: Params<"id">) => update(me, (await params).id, await body(req)));
