import { route, type Params } from "@/lib/api";
import { openConversation } from "@/lib/chat";

export const GET = route(async (_me, _req, { params }: Params<"id">) => openConversation((await params).id));
