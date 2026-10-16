// Runs once when the Next.js server starts. Bookings uses it to send appointment reminders,
// checking once a minute (only in the Node.js runtime).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.BOOKINGS_REMINDERS === "off") return;
  const { sendDueReminders } = await import("./lib/appointments");
  const tick = () => sendDueReminders().catch((e) => console.error("[bookings] reminders:", (e as Error).message));
  setTimeout(tick, 15_000).unref();
  setInterval(tick, 60_000).unref();
}
