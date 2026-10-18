// Runs once when the Next.js server starts. Status uses it to check monitors that are due every
// 30 seconds, and to drop old checks once a day (only in the Node.js runtime).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.STATUS_POLLER === "off") return;
  const { pollDue, prune } = await import("./lib/monitors");
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await pollDue();
    } catch (e) {
      console.error("[status] poll:", (e as Error).message);
    } finally {
      busy = false;
    }
  };
  const sweep = () => prune().catch((e) => console.error("[status] prune:", (e as Error).message));
  setTimeout(tick, 10_000).unref();
  setInterval(tick, 30_000).unref();
  setTimeout(sweep, 60_000).unref();
  setInterval(sweep, 24 * 3600_000).unref();
}
