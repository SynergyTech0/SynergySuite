import { body, route } from "@/lib/api";
import { create, list } from "@/lib/matters";

export const GET = route("compliance", async (me, req) => list(me, new URL(req.url).searchParams.get("status") ?? undefined));
export const POST = route("compliance", async (me, req) => create(me, await body(req)));
