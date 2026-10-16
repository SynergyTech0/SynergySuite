import { isCompanyAdmin } from "@/lib/access";
import { route } from "@/lib/api";

export const GET = route(async (me) => ({ email: me.email, name: me.name, admin: isCompanyAdmin(me.email) }));
