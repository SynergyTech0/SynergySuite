// Runs once when the Next.js server starts: picks up migration copies that were queued, or
// running when the Admin center last stopped (they resume where they left off).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startWorker } = await import("./lib/migrate/runner");
  startWorker();
}
