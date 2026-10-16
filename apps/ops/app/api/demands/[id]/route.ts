import { body, idOf, route, type Params } from "@/lib/api";
import { closeDemand, listDemands } from "@/lib/mfg";

/** Closes a demand: it no longer counts in planning. */
export const DELETE = route(async (_me, _req, { params }: Params<"id">) => {
  await closeDemand(idOf((await params).id));
  return listDemands();
});
