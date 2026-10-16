// Runs once when the Next.js server starts. Desk uses it to start checking the support
// mailbox (only in the Node.js runtime, and only when DESK_IMAP_* is set), and to apply the
// Admin center's ticket retention every hour.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startPoller } = await import("./lib/poller");
  startPoller();
  const { expireTickets } = await import("./lib/tickets");
  const sweep = () => expireTickets().catch((e) => console.error("[desk] retention:", (e as Error).message));
  setTimeout(sweep, 60_000).unref();
  setInterval(sweep, 3_600_000).unref();
}
