import { body, route } from "@/lib/api";
import * as boards from "@/lib/boards";

export const GET = route(async (me) => ({ boards: await boards.listBoards(me) }));

/** New board, blank or from a template. */
export const POST = route(async (me, req) => boards.createBoard(me, await body(req)));
