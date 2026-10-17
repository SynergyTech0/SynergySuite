// Runs once when the Next.js server starts. Campaigns uses it for the send queue (every few
// seconds) and the bounce check (every few minutes), only in the Node.js runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.CAMPAIGNS_SENDER === "off") return;
  const { startSender } = await import("./lib/sender");
  const { startBounceChecks } = await import("./lib/bounces");
  startSender();
  startBounceChecks();
}
