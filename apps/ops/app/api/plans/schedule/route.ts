import { route } from "@/lib/api";
import { scheduleDue } from "@/lib/assets";

/** Opens maintenance orders for every plan that is due now (it also runs every hour). */
export const POST = route(async () => scheduleDue());
