import { type Params, route } from "@/lib/api";
import { draftChecklist } from "@/lib/ai";

/** AI-drafted steps for the job, for the dispatcher to pick from. */
export const POST = route(async (me, _req, { params }: Params<"id">) => draftChecklist(me.email, (await params).id));
