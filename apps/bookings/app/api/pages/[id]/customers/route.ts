import { type Params, route } from "@/lib/api";
import { customers } from "@/lib/appointments";

export const GET = route(async (me, _req, { params }: Params<"id">) => customers(me, (await params).id));
