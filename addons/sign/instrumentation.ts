/**
 * Next.js boot hook (experimental.instrumentationHook in next.config.js).
 * Starts the contract.event outbox worker so events queued before a restart, or while the CRM was
 * down, are delivered without waiting for the next request. CONTRACT_EVENTS_WORKER=0 disables it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startOutboxWorker } = await import("./lib/contract-events");
    startOutboxWorker();
  }
}
