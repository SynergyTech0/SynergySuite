import { type Params, body, tokenRoute } from "@/lib/api";
import { svcNote } from "@/lib/tickets";

// An internal note on the ticket from another suite app: { body, author }. Bearer DESK_API_TOKEN.
export const POST = tokenRoute(async (req, { params }: Params<"number">) => svcNote((await params).number, await body(req)));
