import { route } from "@/lib/api";
import { shiftHistory } from "@/lib/sales";

export const GET = route(async () => shiftHistory());
