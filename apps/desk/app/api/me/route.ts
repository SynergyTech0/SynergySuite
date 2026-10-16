import { route } from "@/lib/api";
import { mailState } from "@/lib/mailer";

export const GET = route(async (me) => ({ email: me.email, name: me.name, mail: mailState() }));
