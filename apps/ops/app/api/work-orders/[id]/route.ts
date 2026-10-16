import { body, idOf, route, type Params } from "@/lib/api";
import { getWorkOrder, updateWorkOrder } from "@/lib/mfg";

export const GET = route(async (_me, _req, { params }: Params<"id">) => getWorkOrder(idOf((await params).id)));
export const PATCH = route(async (_me, req, { params }: Params<"id">) => updateWorkOrder(idOf((await params).id), await body(req)));
