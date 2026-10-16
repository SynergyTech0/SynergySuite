import { route, type Params } from "@/lib/api";
import { retire } from "@/lib/devices";

/** Admins, or the device's owner. */
export const POST = route(async (me, _req, { params }: Params<"id">) => {
  await retire(me, (await params).id);
  return { ok: true };
});
