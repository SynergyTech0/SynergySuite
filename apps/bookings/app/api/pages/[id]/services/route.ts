import { type Params, body, route } from "@/lib/api";
import { type ServiceInput, createService } from "@/lib/pages";

export const POST = route(async (me, req, { params }: Params<"id">) => createService(me, (await params).id, await body<ServiceInput>(req)));
