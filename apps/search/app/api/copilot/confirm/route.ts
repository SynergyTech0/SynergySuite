import { body, route } from "@/lib/api";
import { confirm } from "@/lib/copilot/copilot";

export const dynamic = "force-dynamic";

/**
 * POST { id, confirm: true, edits? }: the person pressed Confirm on a proposal. Runs it once, as
 * them, through the app's own API. No model is involved here.
 */
export const POST = route(async (me, req) => confirm(me, await body(req)));
