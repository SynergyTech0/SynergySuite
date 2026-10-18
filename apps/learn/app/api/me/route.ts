import { route } from "@/lib/api";
import { isAuthor, passMark } from "@/lib/learn";

export const GET = route(async (me) => ({ email: me.email, name: me.name, author: isAuthor(me.email), passMark: passMark() }));
