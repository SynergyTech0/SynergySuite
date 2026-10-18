import { body, route } from "@/lib/api";
import { importContacts } from "@/lib/sms";

export const POST = route(async (_me, req) => importContacts((await body<{ csv?: string }>(req)).csv));
