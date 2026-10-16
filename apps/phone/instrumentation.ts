/** Starts the phone worker (ringing timeouts, ringback, voicemail) with the server. PHONE_WORKER=0 turns it off. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.PHONE_WORKER === "0" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startWorker } = await import("./lib/worker");
  startWorker();
}
