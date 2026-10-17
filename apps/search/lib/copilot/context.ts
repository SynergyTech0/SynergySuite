import { appUrl } from "@synergy/config";
import type { Viewer } from "../api";
import { scrub } from "../util";
import { type AppDeps, callApp } from "./client";

/**
 * The item the person has open, read from its app as them. The suite header passes the app and a
 * context string: the app's own hint (Mail: "account=…&folder=…&uid=…") or the page's path and
 * query. Its text is the person's data for summaries and drafts, never instructions.
 */

export interface Item {
  app: string;
  kind: string;
  title: string;
  text: string;
  /** Addresses taken from the item's own headers (not its text): who a reply may go to. */
  people: string[];
  url: string;
}

export const ITEM_MAX = 16_000;
export const SUMMARY_APPS = ["mail", "chat", "notes"] as const;

/** The key=value pairs of a context string ("/path?a=1&b=2" or "a=1&b=2"). */
export function contextParams(context: string): URLSearchParams {
  const s = String(context ?? "").slice(0, 500);
  const q = s.includes("?") ? s.slice(s.indexOf("?") + 1) : s.includes("=") ? s : "";
  return new URLSearchParams(q.split("#")[0]);
}

const id = (v: string | null) => (v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);

/** Visible text of an HTML fragment, roughly. Good enough for a summary; nothing here is rendered. */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d|tr|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

type Person = { name?: string; address?: string };

export async function readItem(app: string, context: string, viewer: Viewer, deps: AppDeps = {}): Promise<Item | null> {
  const env = deps.env ?? process.env;
  const p = contextParams(context);
  if (app === "mail") {
    const account = p.get("account");
    const folder = p.get("folder");
    const uid = Number(p.get("uid"));
    if (!account || !folder || !Number.isInteger(uid) || uid < 1 || account.length > 100 || folder.length > 300) return null;
    const q = new URLSearchParams({ account, folder, uid: String(uid) });
    const m = await callApp<{ subject?: string; from?: Person | null; to?: Person[]; cc?: Person[]; replyTo?: Person[]; date?: string | null; text?: string; html?: string | null }>(
      "mail", viewer, "GET", `/api/message?${q}`, null, deps);
    const who = (x?: Person | null) => (x ? (x.name ? `${x.name} <${x.address}>` : String(x.address ?? "")) : "");
    const header = [
      `From: ${who(m.from)}`,
      `To: ${(m.to ?? []).map(who).join(", ")}`,
      m.cc?.length ? `Cc: ${m.cc.map(who).join(", ")}` : "",
      m.date ? `Date: ${m.date}` : "",
      `Subject: ${m.subject ?? ""}`,
    ].filter(Boolean).join("\n");
    const body = m.text?.trim() ? m.text : htmlText(m.html ?? "");
    const people = [m.from, ...(m.replyTo ?? []), ...(m.to ?? []), ...(m.cc ?? [])].map((x) => String(x?.address ?? "").toLowerCase()).filter(Boolean);
    return { app, kind: "email", title: m.subject || "(no subject)", text: scrub(`${header}\n\n${body}`, ITEM_MAX), people: [...new Set(people)], url: `${appUrl("mail", env)}/?${q}` };
  }
  if (app === "chat") {
    const channel = id(p.get("channel"));
    if (!channel) return null;
    const ws = id(p.get("ws"));
    const me = await callApp<{ users?: { id: number | string; name: string; email: string }[]; channels?: { id: number | string; name: string | null; kind: string }[] }>(
      "chat", viewer, "GET", `/api/me${ws ? `?ws=${ws}` : ""}`, null, deps);
    const msgs = await callApp<{ user_id: number | string; body: string; created_at: string; deleted_at?: string | null }[]>(
      "chat", viewer, "GET", `/api/channels/${channel}/messages?limit=60`, null, deps);
    const names = new Map((me.users ?? []).map((u) => [String(u.id), u.name || u.email]));
    const ch = (me.channels ?? []).find((c) => String(c.id) === channel);
    const lines = (Array.isArray(msgs) ? msgs : []).filter((m) => !m.deleted_at && m.body).map((m) => `[${m.created_at}] ${names.get(String(m.user_id)) ?? "Someone"}: ${m.body}`);
    return {
      app, kind: "chat channel",
      title: ch?.kind === "dm" ? "Direct message" : `#${ch?.name ?? channel}`,
      text: scrub(lines.join("\n"), ITEM_MAX).slice(-ITEM_MAX),
      people: [],
      url: `${appUrl("chat", env)}/?${new URLSearchParams({ ...(ws ? { ws } : {}), channel })}`,
    };
  }
  if (app === "notes") {
    const page = id(p.get("page"));
    if (!page) return null;
    const pg = await callApp<{ title?: string; body?: string; space_id?: number | string }>("notes", viewer, "GET", `/api/pages/${page}`, null, deps);
    return {
      app, kind: "notes page", title: pg.title || "(untitled page)",
      text: scrub(htmlText(String(pg.body ?? "")), ITEM_MAX),
      people: [],
      url: `${appUrl("notes", env)}/?${new URLSearchParams({ space: String(pg.space_id ?? ""), page })}`,
    };
  }
  return null;
}

/** The item for the model: fenced, so its text can't pose as the person or as instructions. */
export function itemBlock(item: Item): string {
  const attr = (s: string) => scrub(s, 200).replace(/["<>\n]/g, " ");
  return `<item app="${attr(item.app)}" kind="${attr(item.kind)}" title="${attr(item.title)}">\n${item.text.replace(/<\/?item/gi, "‹item")}\n</item>`;
}
