import { tokenRoute } from "@/lib/api";
import { feedFor } from "@/lib/tickets";

export const dynamic = "force-dynamic";

// One customer's tickets for the client portal: a JSON array of
// { number, subject, status, priority, created_at, updated_at, message_count }. Bearer DESK_API_TOKEN.
export const GET = tokenRoute(async (req) => feedFor(new URL(req.url).searchParams.get("email") ?? ""));
