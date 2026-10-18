// Runs once when the Next.js server starts. Analytics uses it to drop events older than
// ANALYTICS_RETENTION_DAYS once a day, when that is set (only in the Node.js runtime).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !Number(process.env.ANALYTICS_RETENTION_DAYS)) return;
  const { prune } = await import("./lib/sites");
  const sweep = () => prune().catch((e) => console.error("[analytics] prune:", (e as Error).message));
  setTimeout(sweep, 60_000).unref();
  setInterval(sweep, 24 * 3600_000).unref();
}
