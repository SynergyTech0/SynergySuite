import { vroute } from "@/lib/api";
import { myTasks } from "@/lib/hr";

export const GET = vroute(async (v) => myTasks(v));
