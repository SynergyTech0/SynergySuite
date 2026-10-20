/** Starts the transcriber with the server when MEET_TRANSCRIBE=always. MEET_WORKER=0 turns it off on extra replicas. */
export async function register() {
  if (process.env.MEET_WORKER === "0" || process.env.NEXT_PHASE === "phase-production-build") return;
  // Inside this check, so the edge bundle leaves the native media library out.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTranscriber } = await import("./lib/transcriber");
    startTranscriber();
  }
}
