import { route, type Params } from "@/lib/api";
import { sendToDesk } from "@/lib/chat";

/** Hands the chat to Desk as a ticket. */
export const POST = route(async (me, _req, { params }: Params<"id">) => sendToDesk((await params).id, me.email));
