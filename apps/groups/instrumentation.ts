// Runs once when the Next.js server starts. Groups uses it to set every group up again in Chat,
// Drive, Calendar and Mail every 15 minutes, so an app that missed a change catches up.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { syncAll } = await import("./lib/sync");
  const run = () => syncAll().catch((e) => console.error("[groups] sweep", e));
  setTimeout(run, 60_000).unref();
  setInterval(run, 15 * 60_000).unref();
}
