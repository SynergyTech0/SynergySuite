import { body, route, type Params } from "@/lib/api";
import { updateEmployee } from "@/lib/shifts";

export const PATCH = route(async (me, req, { params }: Params<"id">) => updateEmployee(me, (await params).id, await body(req)));
