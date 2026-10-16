import { route } from "@/lib/api";
import { people } from "@/lib/engage";

export const GET = route(async (_me, req) => people(new URL(req.url).searchParams.get("q") ?? ""));
