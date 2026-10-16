import { route, type Params } from "@/lib/api";
import { startExport } from "@/lib/exports";

export const POST = route("compliance", async (me, _req, { params }: Params<"id">) => startExport(me, (await params).id));
