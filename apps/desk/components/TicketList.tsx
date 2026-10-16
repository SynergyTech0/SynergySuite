"use client";
import { Inbox } from "lucide-react";
import type { Ticket } from "@/lib/types";
import { when } from "./client";

// The middle pane: one row per ticket, newest activity first.
export function TicketList({ tickets, selected, onOpen, query, view }: {
  tickets: Ticket[] | null; selected: number | null; onOpen: (id: number) => void; query: string; view: string;
}) {
  if (!tickets) return <div className="listbody"><p className="muted pad">Loading…</p></div>;
  if (!tickets.length) {
    return (
      <div className="listbody">
        <div className="empty grow">
          <Inbox size={40} strokeWidth={1.2} />
          <p>{query ? "No tickets match your search." : view === "open" ? "No open tickets. Nice work." : "Nothing here."}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="listbody">
      <ul className="tlist">
        {tickets.map((t) => (
          <li key={t.id}>
            <button className={`trow${selected === t.id ? " sel" : ""}${t.lastDirection === "inbound" && t.status === "open" ? " waiting" : ""}`} onClick={() => onOpen(t.id)}>
              <div className="trowtop">
                <span className="tfrom">{t.requesterName || t.requesterEmail}</span>
                <span className="twhen">{when(t.updatedAt)}</span>
              </div>
              <div className="tsubject">
                <span className={`pri pri-${t.priority}`} title={`${t.priority} priority`} />
                <span className="fname">{t.subject}</span>
              </div>
              <div className="tpreview">{t.preview || "No messages yet"}</div>
              <div className="tmeta">
                <span className="mono">{t.number}</span>
                <span className={`st st-${t.status}`}>{t.status}</span>
                {t.assignee && <span className="muted">{t.assignee.split("@")[0]}</span>}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
