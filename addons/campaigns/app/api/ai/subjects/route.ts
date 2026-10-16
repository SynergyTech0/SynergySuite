import { body, route } from "@/lib/api";
import { suggestSubjects } from "@/lib/ai";

export const POST = route(async (ctx, req) => ({ subjects: await suggestSubjects(ctx, await body(req)) }));
