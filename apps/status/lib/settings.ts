import { q } from "./db";
import { text } from "./util";

export type PageSettings = { title: string; intro: string };

const DEFAULTS: PageSettings = { title: "System status", intro: "" };

export async function getSettings(): Promise<PageSettings> {
  const rows = await q<{ key: string; value: string }>(`SELECT key, value FROM settings WHERE key IN ('title', 'intro')`);
  const out = { ...DEFAULTS };
  for (const r of rows) if (r.key === "title" || r.key === "intro") out[r.key] = r.value;
  if (!out.title) out.title = DEFAULTS.title;
  return out;
}

export async function saveSettings(b: { title?: unknown; intro?: unknown }): Promise<PageSettings> {
  const pairs: [string, string][] = [];
  if (b.title !== undefined) pairs.push(["title", text(b.title, 120)]);
  if (b.intro !== undefined) pairs.push(["intro", text(b.intro, 1000)]);
  for (const [k, v] of pairs) {
    await q(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, v]);
  }
  return getSettings();
}
