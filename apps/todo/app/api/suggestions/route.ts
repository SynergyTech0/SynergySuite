import { route } from "@/lib/api";
import { suggestions } from "@/lib/todo";

export const GET = route(async (me, req) => suggestions(me.email, new URL(req.url).searchParams.get("today") ?? ""));
