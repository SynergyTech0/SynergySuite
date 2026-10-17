import { type Params, tokenRoute } from "@/lib/api";
import { svcTicket } from "@/lib/tickets";

export const dynamic = "force-dynamic";

// One ticket by number for Field Service: { number, subject, status, priority, requesterEmail,
// requesterName, firstMessage }. Bearer DESK_API_TOKEN.
export const GET = tokenRoute(async (_req, { params }: Params<"number">) => svcTicket((await params).number));
