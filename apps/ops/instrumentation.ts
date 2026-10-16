// Runs once when the Next.js server starts (Node.js runtime only). Ops uses it to open preventive
// maintenance that has come due, every hour, and when Commerce is linked, to send queued stock
// moves to it every minute and copy its counts back every five.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { scheduleDue } = await import("./lib/assets");
  const { commerceLinked, refreshStock, syncStockMoves } = await import("./lib/commerce");
  const schedule = () => scheduleDue().catch((e) => console.error("[ops] maintenance schedule:", (e as Error).message));
  setTimeout(schedule, 30_000).unref();
  setInterval(schedule, 3_600_000).unref();
  if (commerceLinked()) {
    const sync = () => syncStockMoves().catch((e) => console.error("[ops] commerce sync:", (e as Error).message));
    const refresh = () => refreshStock().catch((e) => console.error("[ops] stock refresh:", (e as Error).message));
    setInterval(sync, 60_000).unref();
    setTimeout(refresh, 20_000).unref();
    setInterval(refresh, 300_000).unref();
  }
}
