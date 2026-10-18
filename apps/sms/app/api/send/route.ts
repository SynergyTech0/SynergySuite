import { body, route } from "@/lib/api";
import { sendOne } from "@/lib/sms";

export const POST = route(async (me, req) => sendOne(me, await body(req)));
