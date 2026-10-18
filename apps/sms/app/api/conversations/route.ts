import { route } from "@/lib/api";
import { conversations } from "@/lib/sms";

export const GET = route(async () => conversations());
