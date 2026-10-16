import { route, type Params } from "@/lib/api";
import { releaseHold } from "@/lib/matters";

export const POST = route("compliance", async (me, _req, { params }: Params<"id">) => releaseHold(me, (await params).id));
