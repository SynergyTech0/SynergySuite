// Runs once when the Next.js server starts. Mail uses it to start the legal hold sweep, which
// copies the mail of people on hold (only in the Node.js runtime, and only when
// ADMIN_INTERNAL_URL is set).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startPreserver } = await import("./lib/preserver");
  startPreserver();
}
