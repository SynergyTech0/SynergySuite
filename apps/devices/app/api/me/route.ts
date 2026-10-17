import { aiEnabled } from "@/lib/ai";
import { route } from "@/lib/api";

export const GET = route(async (me) => ({ ...me, ai: await aiEnabled() }));
