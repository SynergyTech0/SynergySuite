import { route, type Params } from "@/lib/api";
import { getSearch } from "@/lib/searches";

export const GET = route("compliance", async (me, _req, { params }: Params<"id">) => getSearch(me, (await params).id));
