// Runs once when the Next.js server starts. With Commerce linked, Field Service retries parts that
// didn't reach it (Commerce was down, or a request timed out) every five minutes.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { commerceLinked, syncParts } = await import("./lib/parts");
  if (!commerceLinked()) return;
  const sweep = () => syncParts().catch((e) => console.error("[field] parts to Commerce:", (e as Error).message));
  setTimeout(sweep, 30_000).unref();
  setInterval(sweep, 300_000).unref();
}
