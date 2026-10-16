import { type Params, body, route } from "@/lib/api";
import { getForStaff, moveByStaff } from "@/lib/appointments";

export const GET = route(async (me, _req, { params }: Params<"id">) => getForStaff(me, (await params).id));
/** Moves it: { start }. */
export const PATCH = route(async (me, req, { params }: Params<"id">) => moveByStaff(me, (await params).id, (await body<{ start?: string }>(req)).start));
