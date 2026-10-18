import { body, route } from "@/lib/api";
import { createContact, listContacts } from "@/lib/sms";

export const GET = route(async (_me, req) => listContacts(new URL(req.url).searchParams.get("q") ?? ""));
export const POST = route(async (_me, req) => createContact(await body(req)));
