import { route } from "@/lib/api";
import { boardAiConfig } from "@/lib/ai";

export const GET = route(async (me) => ({ ...me, ai: !!boardAiConfig() }));
