import { route } from "@/lib/api";
import { myShifts } from "@/lib/shifts";

export const GET = route(async (me) => myShifts(me));
