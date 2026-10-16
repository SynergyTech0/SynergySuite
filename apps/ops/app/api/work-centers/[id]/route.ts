import { body, idOf, route, type Params } from "@/lib/api";
import { saveWorkCenter } from "@/lib/mfg";

export const PATCH = route(async (_me, req, { params }: Params<"id">) => saveWorkCenter(idOf((await params).id), await body(req)));
