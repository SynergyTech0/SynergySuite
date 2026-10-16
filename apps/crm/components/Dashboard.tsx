"use client";
// The dashboard: pipeline totals, deals by stage, and the leads and deals to look at next.
import { useEffect, useState } from "react";
import type { Dashboard as Data } from "@/lib/dashboard";
import { STAGE_ORDER } from "@/lib/pipeline";
import { LEAD_STATUSES, label } from "@/lib/types";
import { api, compactMoney, formatDate, formatMoney } from "./client";
import { SummaryBar } from "./Pipeline";
import { Avatar, Badge, Score, type AppCtx } from "./shared";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function Dashboard({ app }: { app: AppCtx }) {
  const [d, setD] = useState<Data | null>(null);
  const [scope, setScope] = useState<"all" | "mine">("all");
  useEffect(() => {
    void api<Data>("/api/dashboard").then(setD).catch((e) => app.say(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- app.version refreshes after changes elsewhere
  }, [app.version]);
  if (!d) return <p className="muted pad">Loading…</p>;
  const p = scope === "all" ? d.pipeline : d.mine;
  const max = Math.max(1, ...STAGE_ORDER.map((s) => p.byStage[s].amount));
  const first = app.me.name.split(" ")[0] || "there";
  const totalLeads = LEAD_STATUSES.reduce((n, s) => n + (d.leadsByStatus[s] ?? 0), 0);

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Welcome back, {first}</h1>
          <p className="muted" style={{ margin: "2px 0 0" }}>
            {d.counts.myOpenActivities ? (
              <button className="link" onClick={() => app.go("myday")}>{d.counts.myOpenActivities} open {d.counts.myOpenActivities === 1 ? "item" : "items"} on My Day</button>
            ) : "Nothing open on My Day."}
            {` · ${plural(d.counts.openLeads, "open lead")} · ${plural(d.counts.accounts, "account")} · ${plural(d.counts.contacts, "contact")}`}
          </p>
        </div>
        <div className="seg" role="group" aria-label="Whose pipeline" style={{ display: "flex", gap: 4 }}>
          <button className={scope === "all" ? "on" : ""} aria-pressed={scope === "all"} onClick={() => setScope("all")}>Everyone</button>
          <button className={scope === "mine" ? "on" : ""} aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>Mine</button>
        </div>
      </div>
      <SummaryBar summary={p} />
      <div className="cols">
        <section className="panel">
          <h3>Pipeline by stage <button className="btn small ghost" onClick={() => app.go("pipeline")}>Open board</button></h3>
          <div className="bars">
            {STAGE_ORDER.map((s) => {
              const r = p.byStage[s];
              return (
                <div className="bar" key={s} title={`${r.count} deals, ${formatMoney(r.amount)}, weighted ${formatMoney(r.weightedAmount)}`}>
                  <span>{label(s)} <span className="muted">({r.count})</span></span>
                  <span className="track"><span className={`fill${s === "closed_won" ? " won" : s === "closed_lost" ? " lost" : ""}`} style={{ width: `${(r.amount / max) * 100}%`, display: "block" }} /></span>
                  <span className="num">{compactMoney(r.amount)}</span>
                </div>
              );
            })}
          </div>
        </section>
        <section className="panel">
          <h3>Leads by status <span className="muted">{totalLeads}</span></h3>
          <div className="bars">
            {LEAD_STATUSES.map((s) => {
              const n = d.leadsByStatus[s] ?? 0;
              return (
                <div className="bar" key={s}>
                  <span>{label(s)}</span>
                  <span className="track"><span className={`fill${s === "converted" ? " won" : s === "unqualified" ? " lost" : ""}`} style={{ width: `${(n / Math.max(1, totalLeads)) * 100}%`, display: "block" }} /></span>
                  <span className="num">{n}</span>
                </div>
              );
            })}
          </div>
        </section>
        <section className="panel">
          <h3>Newest open leads <button className="btn small ghost" onClick={() => app.go("leads")}>All leads</button></h3>
          {d.recentLeads.length ? d.recentLeads.map((l) => (
            <button key={l.id} className="linkrow" onClick={() => app.go("leads", l.id)}>
              <Avatar name={l.name} />
              <span className="grow" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span className="rname">{l.name}</span>
                <span className="rsub">{[l.company, label(l.source)].filter(Boolean).join(" · ")}</span>
              </span>
              <Score value={l.score} />
              <Badge value={l.status} />
            </button>
          )) : <p className="muted small">No open leads.</p>}
        </section>
        <section className="panel">
          <h3>Closing next <button className="btn small ghost" onClick={() => app.go("opportunities")}>All deals</button></h3>
          {d.closingSoon.length ? d.closingSoon.map((o) => (
            <button key={o.id} className="linkrow" onClick={() => app.go("opportunities", o.id)}>
              <span className="grow" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span className="rname">{o.name}</span>
                <span className="rsub">{o.accountName} · {formatDate(o.closeDate)}</span>
              </span>
              <strong className="num">{formatMoney(o.amount)}</strong>
              <Badge value={o.stage} />
            </button>
          )) : <p className="muted small">No open deals with a close date.</p>}
        </section>
      </div>
    </div>
  );
}
