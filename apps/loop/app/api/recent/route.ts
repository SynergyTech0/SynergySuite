import { route } from "@/lib/api";
import { recent } from "@/lib/loop";

export const GET = route(async (me) => ({ items: await recent(me) }));
