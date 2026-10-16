import { route } from "@/lib/api";
import { plannerBoards } from "@/lib/planner";

/** The signed-in person's Planner boards, to link one to a project. */
export const GET = route(async (me) => plannerBoards(me));
