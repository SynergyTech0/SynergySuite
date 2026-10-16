"use client";
// Compliance policies: rules a device must meet, per platform or for all of them.
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, useData } from "./client";
import { Modal } from "./Modal";
import { type AppCtx, Badge, Empty, PLATFORM } from "./shared";

export const RULE_LABEL: Record<string, string> = {
  disk_encryption: "Disk encryption", firewall: "Firewall on", antivirus: "Antivirus running", screen_lock: "Screen lock",
  system_protection: "System protection", auto_update: "Automatic updates", os_min_version: "Minimum OS version",
  checked_in: "Checked in recently", max_admins: "Limit administrators", max_vulnerabilities: "Limit vulnerabilities", no_open_alerts: "No open threats",
};

type Rule = { check: string; version?: string; days?: number; count?: number; severity?: string };
type Policy = { id: string; name: string; description: string; platforms: string[]; rules: Rule[]; enabled: boolean };
type RuleInfo = { check: string; label: string; describe: string; platforms: string[] };

export function ruleText(r: Rule): string {
  const l = RULE_LABEL[r.check] ?? r.check;
  if (r.check === "os_min_version") return `${l}: ${r.version}`;
  if (r.check === "checked_in") return `${l}: within ${r.days} days`;
  if (r.check === "max_admins") return `${l}: at most ${r.count}`;
  if (r.check === "max_vulnerabilities") return `${l}: at most ${r.count} ${r.severity} or worse`;
  if (r.check === "no_open_alerts") return `${l}: ${r.severity} or worse`;
  return l;
}

export function Policies({ app }: { app: AppCtx }) {
  const [data, reload] = useData<{ policies: Policy[]; rules: RuleInfo[] }>("/api/policies", app.say);
  const [editing, setEditing] = useState<Policy | "new" | null>(null);
  const run = (p: Promise<unknown>, msg: string) => p.then(() => { app.say(msg); reload(); }).catch((e) => app.say(e.message));

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Compliance policies</h1>
          <p className="muted">A device is compliant when it passes every rule of every policy for its platform. Settings a device hasn&apos;t reported are never counted as passing.</p>
        </div>
        <button className="btn primary" onClick={() => setEditing("new")}><Plus size={16} /> New policy</button>
      </div>
      {!data ? <p className="muted">Loading…</p> : !data.policies.length ? (
        <section className="panel">
          <Empty>
            <h2>No policies yet</h2>
            <p>Until there is one, every device shows as not evaluated. Start from the security baseline (encrypted, firewalled, screen lock, checked in within 14 days, no open high-severity threats) and adjust it.</p>
            <button className="btn primary" onClick={() => run(api("/api/policies", { method: "POST", json: { template: "baseline" } }), "Security baseline created")}>Create the security baseline</button>
          </Empty>
        </section>
      ) : (
        data.policies.map((p) => (
          <section className="panel" key={p.id}>
            <h3>
              <span style={{ display: "flex", gap: 8, alignItems: "center", textTransform: "none", letterSpacing: 0, color: "var(--text)", fontSize: 15 }}>
                {p.name}
                {p.enabled ? null : <Badge tone="gray">Off</Badge>}
                <span className="muted small" style={{ fontWeight: 400 }}>{p.platforms.length ? p.platforms.map((x) => PLATFORM[x]).join(", ") : "All platforms"}</span>
              </span>
              <span className="toolbar">
                <button className="btn small" onClick={() => run(api(`/api/policies/${p.id}`, { method: "PATCH", json: { enabled: !p.enabled } }), p.enabled ? "Policy turned off" : "Policy turned on")}>{p.enabled ? "Turn off" : "Turn on"}</button>
                <button className="btn small" onClick={() => setEditing(p)}>Edit</button>
              </span>
            </h3>
            {p.description ? <p className="muted small" style={{ margin: "0 0 8px" }}>{p.description}</p> : null}
            <div className="chips">{p.rules.map((r, i) => <span key={i} className="chip plain">{ruleText(r)}</span>)}</div>
          </section>
        ))
      )}
      {editing && data ? (
        <PolicyEditor
          app={app}
          policy={editing === "new" ? null : editing}
          rules={data.rules}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      ) : null}
    </div>
  );
}

const DEFAULTS: Record<string, Rule> = {
  os_min_version: { check: "os_min_version", version: "" },
  checked_in: { check: "checked_in", days: 14 },
  max_admins: { check: "max_admins", count: 2 },
  max_vulnerabilities: { check: "max_vulnerabilities", severity: "critical", count: 0 },
  no_open_alerts: { check: "no_open_alerts", severity: "high" },
};

function PolicyEditor({ app, policy, rules, onClose, onSaved }: { app: AppCtx; policy: Policy | null; rules: RuleInfo[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(policy?.name ?? "");
  const [description, setDescription] = useState(policy?.description ?? "");
  const [platforms, setPlatforms] = useState<string[]>(policy?.platforms ?? []);
  const [list, setList] = useState<Rule[]>(policy?.rules ?? [{ check: "disk_encryption" }]);
  const [err, setErr] = useState("");
  const unused = rules.filter((r) => !list.some((x) => x.check === r.check));
  const set = (i: number, patch: Partial<Rule>) => setList((l) => l.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Modal title={policy ? `Edit ${policy.name}` : "New compliance policy"} onClose={onClose} wide>
      <form className="form" onSubmit={(e) => {
        e.preventDefault();
        const json = { name, description, platforms, rules: list };
        (policy ? api(`/api/policies/${policy.id}`, { method: "PATCH", json }) : api("/api/policies", { method: "POST", json }))
          .then(() => { app.say(policy ? "Policy saved; devices re-evaluated" : "Policy created; devices evaluated"); onSaved(); })
          .catch((x) => setErr(x.message));
      }}>
        <div className="grid2">
          <label><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></label>
          <label><span>Platforms</span>
            <div className="seg" role="group">
              <button type="button" className={!platforms.length ? "on" : ""} onClick={() => setPlatforms([])}>All</button>
              {Object.entries(PLATFORM).map(([k, v]) => (
                <button type="button" key={k} className={platforms.includes(k) ? "on" : ""} onClick={() => setPlatforms((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))}>{v}</button>
              ))}
            </div>
          </label>
        </div>
        <label><span>Description</span><input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} /></label>
        <fieldset>
          <legend>Rules</legend>
          <div className="rulelist">
            {list.map((r, i) => {
              const info = rules.find((x) => x.check === r.check);
              return (
                <div className="rule" key={r.check}>
                  <div className="grow">
                    <strong>{info?.label ?? r.check}</strong>
                    <div className="muted small">{info?.describe} {info && info.platforms.length < 3 ? `(${info.platforms.map((p) => PLATFORM[p]).join(", ")} only)` : ""}</div>
                  </div>
                  {r.check === "os_min_version" ? <input type="text" placeholder="e.g. 14.0" value={r.version ?? ""} onChange={(e) => set(i, { version: e.target.value })} aria-label="Minimum version" /> : null}
                  {r.check === "checked_in" ? <input type="number" min={1} max={365} value={r.days ?? 14} onChange={(e) => set(i, { days: Number(e.target.value) })} aria-label="Days" /> : null}
                  {r.check === "max_admins" || r.check === "max_vulnerabilities" ? <input type="number" min={0} value={r.count ?? 0} onChange={(e) => set(i, { count: Number(e.target.value) })} aria-label="At most" /> : null}
                  {r.check === "max_vulnerabilities" || r.check === "no_open_alerts" ? (
                    <select value={r.severity} onChange={(e) => set(i, { severity: e.target.value })} aria-label="Severity">
                      <option value="critical">Critical</option><option value="high">High or worse</option>
                    </select>
                  ) : null}
                  <button type="button" className="iconbtn" aria-label="Remove rule" onClick={() => setList((l) => l.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
                </div>
              );
            })}
          </div>
          {unused.length ? (
            <select value="" onChange={(e) => e.target.value && setList((l) => [...l, DEFAULTS[e.target.value] ?? { check: e.target.value }])} aria-label="Add a rule">
              <option value="">Add a rule…</option>
              {unused.map((r) => <option key={r.check} value={r.check}>{r.label}</option>)}
            </select>
          ) : null}
        </fieldset>
        <p className="error small">{err}</p>
        <div className="actions">
          {policy ? <button type="button" className="btn danger" style={{ marginRight: "auto" }} onClick={() => api(`/api/policies/${policy.id}`, { method: "DELETE" }).then(() => { app.say("Policy deleted"); onSaved(); }).catch((x) => setErr(x.message))}>Delete</button> : null}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">{policy ? "Save" : "Create"}</button>
        </div>
      </form>
    </Modal>
  );
}
