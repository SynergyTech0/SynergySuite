import { route } from "@/lib/api";
import { booksStatus, syncStockMoves } from "@/lib/books";

/** Retries sending queued stock moves to Books now. */
export const POST = route(async () => ({ ...(await syncStockMoves()), status: await booksStatus() }));
