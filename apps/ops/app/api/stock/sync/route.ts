import { route } from "@/lib/api";
import { refreshStock, stockLink, syncStockMoves } from "@/lib/commerce";

/** Sends queued stock moves to Commerce now, then copies its counts back. */
export const POST = route(async () => {
  const sent = await syncStockMoves();
  const refreshed = await refreshStock();
  return { ...sent, ...refreshed, status: await stockLink() };
});
