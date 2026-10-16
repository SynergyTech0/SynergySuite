import { body, route } from "@/lib/api";
import { addDemand, listDemands } from "@/lib/mfg";

export const GET = route(async () => listDemands());
export const POST = route(async (me, req) => {
  await addDemand(await body(req), me.email);
  return listDemands();
});
