import { randomBytes } from "node:crypto";
import { q } from "./db";
import { UserError, text } from "./util";

export type Widget = {
  id: string;
  widget_key: string;
  name: string;
  domain: string;
  greeting: string;
  color: string;
  ask_email: boolean;
  owner_email: string;
  created_at: Date;
};

const COLS = "id::text, widget_key, name, domain, greeting, color, ask_email, owner_email, created_at";

export const newKey = () => `wc_${randomBytes(9).toString("base64url")}`;

/** The host a site was entered with: "https://www.example.com/x" becomes "www.example.com". */
export function cleanDomain(v: unknown): string {
  const d = String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .slice(0, 200);
  if (d && !/^[a-z0-9.-]+$/.test(d)) throw new UserError("Enter the site's domain, like example.com");
  return d;
}

/** A #rrggbb colour; anything else is refused so it can't break out of the widget's styles. */
export function cleanColor(v: unknown, fallback = "#0f6cbd"): string {
  const c = String(v ?? "").trim();
  if (!c) return fallback;
  if (!/^#[0-9a-fA-F]{6}$/.test(c)) throw new UserError("Pick a colour like #0f6cbd");
  return c.toLowerCase();
}

/**
 * True when a request from `origin` may use a widget for `domain`: the domain itself, "www." in
 * front of it, or a subdomain. A widget with no domain works on any site.
 */
export function originAllowed(origin: string | null, domain: string): boolean {
  const want = domain.replace(/^www\./, "");
  if (!want) return true;
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === want || host.endsWith(`.${want}`);
  } catch {
    return false;
  }
}

function widgetId(v: unknown): string {
  const s = String(v ?? "");
  if (!/^\d{1,18}$/.test(s)) throw new UserError("Not found", 404);
  return s;
}

export async function listWidgets(): Promise<(Widget & { open_count: number })[]> {
  return q(
    `SELECT ${COLS.split(", ").map((c) => `w.${c}`).join(", ")},
       (SELECT count(*) FROM conversations c WHERE c.widget_id = w.id AND c.status = 'open')::int AS open_count
     FROM widgets w ORDER BY lower(w.name), w.id`,
  );
}

export async function widgetByKey(key: unknown): Promise<Widget | null> {
  const k = String(key ?? "").slice(0, 64);
  if (!k) return null;
  const [w] = await q<Widget>(`SELECT ${COLS} FROM widgets WHERE widget_key = $1`, [k]);
  return w ?? null;
}

type WidgetInput = { name?: unknown; domain?: unknown; greeting?: unknown; color?: unknown; askEmail?: unknown };

export async function createWidget(owner: string, b: WidgetInput): Promise<Widget> {
  const name = text(b.name, 100);
  if (!name) throw new UserError("Give the widget a name");
  const [w] = await q<Widget>(
    `INSERT INTO widgets (widget_key, name, domain, greeting, color, ask_email, owner_email) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLS}`,
    [newKey(), name, cleanDomain(b.domain), text(b.greeting, 300) || "Hi! How can we help?", cleanColor(b.color), b.askEmail === undefined ? true : Boolean(b.askEmail), owner],
  );
  return w;
}

export async function updateWidget(id: string, b: WidgetInput): Promise<Widget> {
  const [cur] = await q<Widget>(`SELECT ${COLS} FROM widgets WHERE id = $1`, [widgetId(id)]);
  if (!cur) throw new UserError("Not found", 404);
  const name = b.name === undefined ? cur.name : text(b.name, 100);
  if (!name) throw new UserError("Give the widget a name");
  const [w] = await q<Widget>(
    `UPDATE widgets SET name = $2, domain = $3, greeting = $4, color = $5, ask_email = $6 WHERE id = $1 RETURNING ${COLS}`,
    [
      cur.id,
      name,
      b.domain === undefined ? cur.domain : cleanDomain(b.domain),
      b.greeting === undefined ? cur.greeting : text(b.greeting, 300) || "Hi! How can we help?",
      b.color === undefined ? cur.color : cleanColor(b.color),
      b.askEmail === undefined ? cur.ask_email : Boolean(b.askEmail),
    ],
  );
  return w;
}

export async function deleteWidget(id: string): Promise<void> {
  await q(`DELETE FROM widgets WHERE id = $1`, [widgetId(id)]);
}

/** The snippet to paste into a site's pages. */
export function snippet(key: string, domain = process.env.SUITE_DOMAIN): string {
  const base = domain ? `https://livechat.${domain}` : "http://localhost:3900";
  return `<script defer src="${base}/widget.js" data-widget="${key}"></script>`;
}
