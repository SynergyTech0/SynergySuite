import { type Params, body, route } from "@/lib/api";
import { cancelBooking, moveBooking } from "@/lib/schedule";

export const PATCH = route(async (me, req, { params }: Params<"id">) => moveBooking(me.email, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await cancelBooking(me.email, (await params).id);
});
