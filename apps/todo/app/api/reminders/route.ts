import { route } from "@/lib/api";
import { dueReminders } from "@/lib/todo";

/** Polled by the open app; returns each due reminder once. */
export const POST = route(async (me) => dueReminders(me.email));
