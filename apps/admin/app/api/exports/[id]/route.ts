import { route, type Params } from "@/lib/api";
import { getExport } from "@/lib/exports";

export const GET = route("compliance", async (me, _req, { params }: Params<"id">) => getExport(me, (await params).id));
