import { route } from "@/lib/api";
import { roleOf } from "@/lib/staff";

/** Who is signed in and what they do here. The first person into a new install becomes its dispatcher. */
export const GET = route(async (me) => ({ email: me.email, name: me.name, role: await roleOf(me.email, me.name) }));
