"use client";

// The bell in the Office title bar and document list: mentions of the
// signed-in person in comments on documents they can open. Polls every
// 30 seconds while the tab is visible.
import { useCallback, useEffect, useRef, useState } from "react";

type Item = { id: string; kind: string; doc_id: string; doc_kind: string; doc_title: string; thread_id: string | null; actor_name: string; excerpt: string; read: boolean; created_ms: string };
const PATH: Record<string, string> = { doc: "doc", sheet: "sheet", slide: "slides" };

export function notificationHref(n: Pick<Item, "doc_kind" | "doc_id" | "thread_id">): string {
  return `/${PATH[n.doc_kind] || "doc"}/${encodeURIComponent(n.doc_id)}${n.thread_id ? `?comment=${encodeURIComponent(n.thread_id)}` : ""}`;
}

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

export default function NotificationBell() {
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications");
      if (!r.ok) return;
      const j = (await r.json()) as { items: Item[]; unread: number };
      setItems(j.items || []);
      setUnread(j.unread || 0);
    } catch {
      /* offline */
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 30000);
    window.addEventListener("focus", load);
    window.addEventListener("office-notifications", load);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", load);
      window.removeEventListener("office-notifications", load);
    };
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const mark = async (body: { ids?: string[]; all?: boolean }) => {
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
    load();
  };
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} className="relative h-8 w-8 grid place-items-center rounded-full text-slate-500 hover:bg-slate-100" title="Notifications" aria-label="Notifications" data-testid="notif-bell">
        <span aria-hidden>🔔</span>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-4 text-center" data-testid="notif-count">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-50 w-80 max-h-[70vh] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg text-left" data-testid="notif-list">
          <div className="flex items-center px-3 py-2 border-b border-slate-100">
            <span className="text-sm font-semibold text-slate-700">Notifications</span>
            {unread > 0 && <button className="ml-auto text-[11px] text-indigo-600 hover:underline" onClick={() => mark({ all: true })}>Mark all read</button>}
          </div>
          {items.length === 0 && <p className="text-xs text-slate-400 p-4 text-center">Nothing yet. When someone @mentions you in a comment, it shows up here.</p>}
          {items.map((n) => (
            <a
              key={n.id}
              href={notificationHref(n)}
              data-notif={n.id}
              onClick={() => !n.read && void mark({ ids: [n.id] })}
              className={`block px-3 py-2 border-b border-slate-50 hover:bg-slate-50 ${n.read ? "" : "bg-indigo-50/50"}`}
            >
              <div className="text-[12px] text-slate-700">
                <b>{n.actor_name}</b> mentioned you in <b>{n.doc_title || "Untitled"}</b>
              </div>
              <div className="text-[12px] text-slate-500 line-clamp-2">{n.excerpt}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">{ago(Number(n.created_ms))}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
