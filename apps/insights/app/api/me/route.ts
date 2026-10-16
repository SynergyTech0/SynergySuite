import { route } from "@/lib/api";

export const GET = route(async (me) => ({ email: me.email, name: me.name }));
