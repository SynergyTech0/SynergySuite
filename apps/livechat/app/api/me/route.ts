import { isAdmin, route } from "@/lib/api";
import { deskConfigured } from "@/lib/chat";

export const GET = route(async (me) => ({ email: me.email, name: me.name, admin: isAdmin(me.email), desk: deskConfigured() }));
