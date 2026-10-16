import { route } from "@/lib/api";
import { people } from "@/lib/directory";

export const GET = route(async (me, req) => people(new URL(req.url).searchParams.get("q") ?? "", me));
