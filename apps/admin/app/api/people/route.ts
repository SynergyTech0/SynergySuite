import { body, route } from "@/lib/api";
import { addPerson, people } from "@/lib/directory";

export const GET = route("people", async (_me, req) => people(new URL(req.url).searchParams.get("q") ?? ""));
export const POST = route("people", async (me, req) => addPerson(me, await body(req)));
