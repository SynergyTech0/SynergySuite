import { route } from "@/lib/api";
import * as members from "@/lib/members";
import { scoringEnabled } from "@/lib/scoring";

export const GET = route(async (ctx) => ({ me: ctx, members: await members.list(), ai: scoringEnabled() }));
