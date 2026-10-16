// Runs once when the Next.js server starts. Insights uses it to set Metabase up and connect the
// suite's databases as soon as Metabase answers (it takes a minute or two to start), and then
// to bring the sources' read-only grants up to date every INSIGHTS_SYNC_MINUTES (0 turns that off).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.INSIGHTS_SECRET) {
    console.error("[insights] INSIGHTS_SECRET is not set; Insights can't reach Metabase until it is.");
    return;
  }
  const { metabase } = await import("./lib/metabase");
  const { syncAll } = await import("./lib/sources");
  const mb = metabase();
  const run = async () => {
    const r = await syncAll(mb);
    if (r.error) console.error("[insights] sync:", r.error);
    for (const s of r.sources) if (s.status === "error") console.error(`[insights] source ${s.source}:`, s.detail);
    const ok = r.sources.filter((s) => s.status === "ok").map((s) => s.source);
    if (!r.error) console.log(`[insights] synced: ${ok.join(", ") || "no sources"}`);
    return r;
  };
  // Until Metabase is up, try again every 15 seconds.
  const first = async () => {
    if ((await mb.version()) === null) return void setTimeout(first, 15_000).unref();
    const r = await run().catch((e) => ({ error: (e as Error).message }));
    if ("error" in r && r.error) setTimeout(first, 60_000).unref();
  };
  setTimeout(first, 2_000).unref();
  const minutes = mb.c.syncMinutes;
  if (minutes > 0) setInterval(() => void run().catch(() => undefined), minutes * 60_000).unref();
}
