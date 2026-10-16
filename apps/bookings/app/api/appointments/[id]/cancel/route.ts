import { type Params, body, route } from "@/lib/api";
import { cancelByStaff } from "@/lib/appointments";

export const POST = route(async (me, req, { params }: Params<"id">) => cancelByStaff(me, (await params).id, (await body<{ reason?: string }>(req)).reason));
