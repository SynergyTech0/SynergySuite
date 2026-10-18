import { body, route, type Params } from "@/lib/api";
import { agentReply } from "@/lib/chat";

export const POST = route(async (me, req, { params }: Params<"id">) => ({ message: await agentReply((await params).id, me.email, await body(req)) }));
