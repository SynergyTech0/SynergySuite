import { body, route } from "@/lib/api";
import { preview } from "@/lib/campaigns";

/** The email as a recipient would see it, with your details standing in for theirs. */
export const POST = route(async (ctx, req) => preview(ctx, await body(req)));
