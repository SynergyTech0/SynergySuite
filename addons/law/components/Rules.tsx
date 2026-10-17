"use client";
import { Search } from "lucide-react";
import { useState } from "react";
import type { AppInfo } from "./types";

/** The state rules Law checks matters and trust accounts against, with links to confirm each. */
export function RulesView({ info }: { info: AppInfo }) {
  const [q, setQ] = useState("");
  const rows = info.jurisdictions.filter((j) => !q || j.name.toLowerCase().includes(q.toLowerCase()) || j.code.toLowerCase() === q.toLowerCase());
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>State rules</h1>
          <p className="sub muted">
            What Law checks: how fast client money must reach trust, how often to reconcile, how long to keep records, and when a fee needs a written
            agreement. These are a working guide, not legal advice; confirm against the rule linked for your state.
          </p>
        </div>
      </div>
      <div className="body">
        <div className="toolbar">
          <label className="searchbox"><Search size={15} /><input placeholder="Find a state" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        </div>
        <div className="tablewrap">
          <table className="grid">
            <thead>
              <tr><th>State</th><th className="num">Deposit within (business days)</th><th className="num">Reconcile every (days)</th><th className="num">Keep records (years)</th><th>Written fee agreement</th><th>Contingency</th><th>Rule</th></tr>
            </thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.code}>
                  <td>{j.name}</td>
                  <td className="num">{j.depositDays}</td>
                  <td className="num">{j.reconcileDays}</td>
                  <td className="num">{j.retentionYears}</td>
                  <td>{j.writtenFeeOver === null ? <span className="muted">No rule set</span> : j.writtenFeeOver === 0 ? "Always" : `Over $${j.writtenFeeOver.toLocaleString()}`}</td>
                  <td>{j.contingencyInWriting ? "In writing" : ""}{j.maxContingencyPct !== null && `, up to ${j.maxContingencyPct}%`}</td>
                  <td><a href={j.url} target="_blank" rel="noreferrer">{j.citation}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
