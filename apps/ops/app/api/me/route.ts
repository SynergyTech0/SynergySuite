import { route } from "@/lib/api";
import { assetCounts } from "@/lib/assets";
import { booksStatus } from "@/lib/books";

export const GET = route(async (me) => ({ me, books: await booksStatus(), counts: await assetCounts(me.email) }));
