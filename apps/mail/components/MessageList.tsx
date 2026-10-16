"use client";
import { Flag, Paperclip, Search, X } from "lucide-react";
import { displayName, shortDate, type MessageSummary } from "@/lib/client";

export function MessageList(props: {
  title: string;
  messages: MessageSummary[] | null;
  total: number;
  selected: number | null;
  sentView: boolean;
  search: string;
  onSearch: (q: string) => void;
  onSelect: (m: MessageSummary) => void;
  onMore: (() => void) | null;
  error: string | null;
}) {
  return (
    <section className="list">
      <div className="listhead">
        <form className="search" onSubmit={(e) => { e.preventDefault(); props.onSearch(String(new FormData(e.currentTarget).get("q") || "")); }}>
          <Search size={15} />
          <input name="q" key={props.search} defaultValue={props.search} placeholder={`Search ${props.title}`} aria-label={`Search ${props.title}`} />
          {props.search && <button type="button" className="iconbtn small" title="Clear search" aria-label="Clear search" onClick={() => props.onSearch("")}><X size={14} /></button>}
        </form>
        <h2>{props.search ? `Results in ${props.title}` : props.title}</h2>
      </div>
      <div className="rows">
        {props.error && <p className="error pad">{props.error}</p>}
        {props.messages === null && !props.error && <p className="muted pad">Loading…</p>}
        {props.messages?.length === 0 && <p className="muted pad empty">{props.search ? "No messages match." : "Nothing in this folder."}</p>}
        {props.messages?.map((m) => {
          const who = props.sentView ? m.to.map(displayName).join(", ") || "(no recipient)" : displayName(m.from) || "(unknown sender)";
          return (
            <button key={m.uid} className={`row${m.seen ? "" : " unread"}${props.selected === m.uid ? " selected" : ""}`}
              onClick={() => props.onSelect(m)}>
              <div className="rowtop">
                <span className="who">{props.sentView ? `To: ${who}` : who}</span>
                <span className="icons">
                  {m.hasAttachments && <Paperclip size={13} />}
                  {m.flagged && <Flag size={13} className="flagged" />}
                </span>
              </div>
              <div className="rowbot">
                <span className="subject">{m.subject || "(no subject)"}</span>
                <span className="date">{shortDate(m.date)}</span>
              </div>
            </button>
          );
        })}
        {props.onMore && <button className="btn ghost more" onClick={props.onMore}>Load older messages</button>}
      </div>
    </section>
  );
}
