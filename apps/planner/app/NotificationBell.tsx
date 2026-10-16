"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { relativeTime } from "@/lib/describe-activity";

type Item = {
  id: string; type: "assigned" | "mentioned" | "commented" | "updated"; readAt: string | null; createdAt: string;
  boardId: string; cardId: string | null; cardTitle: string | null; issueKey: string | null;
  actor: string | null; actorIsMind: boolean | null;
  data: { excerpt?: string; title?: string; changes?: Record<string, unknown> } | null;
};

const POLL_MS = 30000;

function describe(n: Item): string {
  const card = n.issueKey ?? (n.cardTitle ? `“${n.cardTitle}”` : "a card");
  switch (n.type) {
    case "assigned": return `assigned you ${card}`;
    case "mentioned": return `mentioned you on ${card}`;
    case "commented": return `commented on ${card}`;
    case "updated": {
      const c = n.data?.changes ?? {};
      if ("complete" in c) return `${c.complete ? "completed" : "reopened"} ${card}`;
      if ("list" in c) return `moved ${card} to ${(c.list as { to?: string })?.to ?? "another list"}`;
      if ("archived" in c) return `${c.archived ? "archived" : "restored"} ${card}`;
      if ("assignee" in c) return `reassigned ${card}${c.assignee ? ` to ${c.assignee}` : ""}`;
      return `updated ${card}`;
    }
  }
}

/**
 * The bell. Polls rather than holding a socket: notifications are a "when you next look" signal, and
 * the per-board SSE stream only covers the board that is open.
 */
export function NotificationBell() {
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/notifications");
    if (!r.ok) return;
    const d: { items: Item[]; unread: number } = await r.json();
    setItems(d.items);
    setUnread(d.unread);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function markRead(body: { ids?: string[]; all?: boolean }) {
    await fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    load();
  }

  async function openItem(n: Item) {
    if (!n.readAt) await markRead({ ids: [n.id] });
    window.location.href = n.cardId ? `/b/${n.boardId}?card=${n.cardId}` : `/b/${n.boardId}`;
  }

  return (
    <div className="bell" ref={ref}>
      <button className="bellbtn" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open}
        onClick={() => { setOpen((o) => !o); if (!open) load(); }}>
        🔔{unread > 0 && <span className="bellcount">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="bellpanel" role="dialog" aria-label="Notifications">
          <div className="shead">
            <b>Notifications</b>
            <div style={{ flex: 1 }} />
            {unread > 0 && <button className="mini" onClick={() => markRead({ all: true })}>Mark all read</button>}
          </div>
          {items.map((n) => (
            <button key={n.id} className={`bellitem${n.readAt ? "" : " unread"}`} onClick={() => openItem(n)}>
              <div><b>{n.actorIsMind ? "🧠 Mind" : (n.actor ?? "Someone")}</b> {describe(n)}</div>
              {n.data?.excerpt && <div className="bellexcerpt">{n.data.excerpt}</div>}
              <div className="when" style={{ marginLeft: 0 }}>{relativeTime(n.createdAt)}</div>
            </button>
          ))}
          {!items.length && <div className="bempty">You&apos;re all caught up.</div>}
        </div>
      )}
    </div>
  );
}
