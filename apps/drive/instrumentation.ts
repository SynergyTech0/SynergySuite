// Runs once when the Next.js server starts. Drive uses it to empty old things out of recycle
// bins and apply the Admin center's retention every hour (only in the Node.js runtime).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { purgeExpired } = await import("./lib/drive");
  const run = () => purgeExpired().catch((e) => console.error("[drive] purge", e));
  setTimeout(run, 60_000).unref();
  setInterval(run, 3_600_000).unref();
}
