// Runs once when the Next.js server starts (Node.js runtime only). Ops uses it to open preventive
// maintenance that has come due, every hour, and to send queued stock moves to Books every
// minute when Books is linked.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { scheduleDue } = await import("./lib/assets");
  const { booksLinked, syncStockMoves } = await import("./lib/books");
  const schedule = () => scheduleDue().catch((e) => console.error("[ops] maintenance schedule:", (e as Error).message));
  setTimeout(schedule, 30_000).unref();
  setInterval(schedule, 3_600_000).unref();
  if (booksLinked()) {
    const sync = () => syncStockMoves().catch((e) => console.error("[ops] books sync:", (e as Error).message));
    setInterval(sync, 60_000).unref();
  }
}
