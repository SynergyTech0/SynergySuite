import { body, route } from "@/lib/api";
import { createAccount, listAccounts } from "@/lib/trust";

export const GET = route(async (me) => listAccounts(me));
export const POST = route(async (me, req) => createAccount(me, await body(req)));
