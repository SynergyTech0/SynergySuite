import { route } from "@/lib/api";
import { dashboard } from "@/lib/sms";

export const GET = route(async () => dashboard());
