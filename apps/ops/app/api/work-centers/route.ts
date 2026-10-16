import { body, route } from "@/lib/api";
import { listWorkCenters, saveWorkCenter } from "@/lib/mfg";

export const GET = route(async () => listWorkCenters());
export const POST = route(async (_me, req) => saveWorkCenter(null, await body(req)));
