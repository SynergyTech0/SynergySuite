"use client";
import { useEffect, useState } from "react";

/**
 * Shows a dashboard through Metabase's static embedding, with an address Insights signs for
 * the viewer. The address works for eight hours; a page left open longer than that loads the
 * dashboard again with a new one.
 */
export function DashboardFrame({ id, title }: { id: number; title: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/dashboards/${id}/embed`, { cache: "no-store" });
        const body = (await res.json()) as { url?: string; expires?: number; error?: string };
        if (!res.ok || !body.url) throw new Error(body.error || "This dashboard couldn't be opened");
        if (stopped) return;
        setUrl(body.url);
        setError(null);
        const wait = Math.max(60_000, (body.expires ?? 0) - Date.now() - 60_000);
        timer = setTimeout(() => {
          setUrl(null);
          void load();
        }, wait);
      } catch (err) {
        if (!stopped) setError((err as Error).message);
      }
    };
    void load();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  if (error) return <p className="pad error">{error}</p>;
  if (!url) return <p className="pad muted">Loading…</p>;
  return <iframe src={url} title={title} />;
}
