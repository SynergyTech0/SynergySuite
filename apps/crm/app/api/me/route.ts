import { route } from "@/lib/api";
import * as access from "@/lib/access";
import * as members from "@/lib/members";
import { scoringEnabled } from "@/lib/scoring";

export const GET = route(async (ctx) => ({ me: ctx, members: await members.list(), ai: scoringEnabled(), repRead: await access.readScope() }));
