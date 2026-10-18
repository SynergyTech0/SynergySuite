import { route } from "@/lib/api";
import { listConversations } from "@/lib/chat";

export const GET = route(async (me, req) => {
  const u = new URL(req.url);
  return { conversations: await listConversations(u.searchParams.get("status"), u.searchParams.get("mine") ? me.email : undefined) };
});
