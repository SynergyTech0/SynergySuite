import { body, route } from "@/lib/api";
import { listBoms, saveBom } from "@/lib/mfg";

export const GET = route(async (_me, req) => listBoms({ q: new URL(req.url).searchParams.get("q") || undefined }));
export const POST = route(async (me, req) => saveBom(null, await body(req), me.email));
