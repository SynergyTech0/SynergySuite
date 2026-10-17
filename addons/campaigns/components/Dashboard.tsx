"use client";
// The home page: lists, how recent campaigns did, and what is sending or scheduled.
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { Campaign } from "@/lib/types";
import { StatusBadge, Stat } from "./Campaigns";
import { api, formatDateTime, num, pct, type AppCtx } from "./client";

type Data = {
  lists: { audiences: number; subscribed: number; joined30: number; left30: number; suppressed: number };
  sends: { campaigns: number; sent: number; opened: number; clicked: number; bounced: number; unsubscribed: number };
};

export function Dashboard({ ctx }: { ctx: AppCtx }) {
  const [d, setD] = useState<Data | null>(null);
  const [recent, setRecent] = useState<Campaign[]>([]);
  useEffect(() => {
    void api<Data>("/api/dashboard").then(setD).catch((e) => ctx.say(e.message));
    void api<Campaign[]>("/api/campaigns").then((l) => setRecent(l.slice(0, 8))).catch(() => {});
  }, [ctx]);
  const s = ctx.settings;
  const setupNeeded = !s.fromEmail || !s.orgName || !s.postalAddress || s.sender.mode === "off";
  return (
    <div className="page">
      <div className="pagehead">
        <h1>Dashboard</h1>
        {ctx.canEdit && <button className="btn primary" onClick={() => ctx.go({ view: "campaigns" })}><Plus size={16} /> New campaign</button>}
      </div>
      {setupNeeded && (
        <div className="notice warn">
          <span>
            {s.sender.mode === "off" ? `${s.sender.detail}. ` : ""}
            {!s.fromEmail || !s.orgName || !s.postalAddress ? "Fill in who campaigns come from and your postal address before sending." : ""}
          </span>
          <button className="btn small" onClick={() => ctx.go({ view: "settings" })}>Settings</button>
        </div>
      )}
      {d && (
        <>
          <div className="stats">
            <Stat k="Subscribed" v={num(d.lists.subscribed)} sub={`in ${num(d.lists.audiences)} audience${d.lists.audiences === 1 ? "" : "s"}`} />
            <Stat k="Last 30 days" v={`+${num(d.lists.joined30)}`} sub={`${num(d.lists.left30)} unsubscribed`} />
            <Stat k="Open rate" v={pct(d.sends.opened, d.sends.sent)} sub={`${num(d.sends.sent)} emails in ${num(d.sends.campaigns)} campaigns, 90 days`} />
            <Stat k="Click rate" v={pct(d.sends.clicked, d.sends.sent)} sub={`${num(d.sends.bounced)} bounced, ${num(d.sends.unsubscribed)} unsubscribed`} />
          </div>
        </>
      )}
      <div className="panel">
        <h3>Recent campaigns</h3>
        {!recent.length ? (
          <p className="muted small">Nothing sent yet.</p>
        ) : (
          recent.map((c) => (
            <button key={c.id} className="linkrow" onClick={() => ctx.go({ view: "campaigns", id: c.id })}>
              <div className="grow"><div className="rname">{c.name}</div><div className="rsub">{c.audienceName ?? "—"} · {formatDateTime(c.startedAt ?? c.scheduledAt ?? c.updatedAt)}</div></div>
              {c.stats && <span className="small muted">{pct(c.stats.uniqueOpens, c.stats.sent)} opened · {pct(c.stats.uniqueClicks, c.stats.sent)} clicked</span>}
              <StatusBadge status={c.status} />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
