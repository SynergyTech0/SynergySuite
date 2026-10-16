import { route, type Params } from "@/lib/api";
import { deviceVulns } from "@/lib/devices";

export const GET = route(async (me, _req, { params }: Params<"id">) => deviceVulns(me, (await params).id));
