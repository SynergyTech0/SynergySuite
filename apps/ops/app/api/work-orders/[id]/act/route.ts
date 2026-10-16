import { body, idOf, route, type Params } from "@/lib/api";
import { actOnWorkOrder } from "@/lib/mfg";

/** { action: release | start | issue | operation | complete | cancel, ... } */
export const POST = route(async (me, req, { params }: Params<"id">) => actOnWorkOrder(idOf((await params).id), await body(req), me.email));
