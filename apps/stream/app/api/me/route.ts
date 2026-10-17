import { route } from "@/lib/api";
import { aiStatus } from "@/lib/ai";

export const dynamic = "force-dynamic";

/** Who is signed in, and which AI features this suite has turned on. */
export const GET = route(async (me) => ({ ...me, ai: await aiStatus() }));
