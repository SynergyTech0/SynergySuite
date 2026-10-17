import { body, route, type Params } from "@/lib/api";
import { updateIncident } from "@/lib/protection";

export const PATCH = route("protection", async (me, req, { params }: Params<"id">) => updateIncident(me, (await params).id, await body(req)));
