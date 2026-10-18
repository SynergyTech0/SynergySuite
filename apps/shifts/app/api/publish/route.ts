import { body, route } from "@/lib/api";
import { publish } from "@/lib/shifts";

export const POST = route(async (me, req) => publish(me, (await body<{ week?: string }>(req)).week));
