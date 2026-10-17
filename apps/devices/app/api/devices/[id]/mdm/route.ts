import { route, type Params } from "@/lib/api";
import { getDevice } from "@/lib/devices";
import { managementOf } from "@/lib/mdm/apple";

/** The device's Apple management: enrollment, recent commands and profiles. null when it isn't managed. */
export const GET = route(async (me, _req, { params }: Params<"id">) => {
  const d = await getDevice(me, (await params).id);
  return { management: await managementOf(me, d.id) };
});
