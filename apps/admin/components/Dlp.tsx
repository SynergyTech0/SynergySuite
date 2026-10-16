"use client";
// Data loss prevention: rules that stop or warn about sensitive information leaving through
// Mail, Drive and Chat, the alerts apps report, custom sensitive information types, and a place
// to try the rules on some text.
import { AlertTriangle, FlaskConical, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { CustomInfoType, DlpDecision, DlpRule, InfoType, SensitivityLabel } from "@synergy/compliance";
import type { IncidentRecord, RuleRecord } from "@/lib/protection";
import { api, formatDateTime, plural } from "./client";
import { LabelChip } from "./Labels";
import { Confirm, Modal } from "./Modal";
import { appLabel, appsText, Badge, type AppCtx } from "./shared";

type Data = {
  rules: RuleRecord[]; types: InfoType[]; customTypes: CustomInfoType[]; internalDomains: string[]; extraDomains: string[];
  labels: SensitivityLabel[]; templates: Omit<DlpRule, "id">[]; apps: { id: string; name: string }[];
};
type Tab = "rules" | "alerts" | "types" | "test";
const TABS: [Tab, string][] = [["rules", "Rules"], ["alerts", "Alerts"], ["types", "Sensitive info types"], ["test", "Try it"]];

/** Apps that check DLP rules today. */
const CHECKING = ["mail", "drive", "chat"];

const ACTION_TEXT = { audit: "Record only", warn: "Warn, allow with a reason", block: "Block" } as const;
const actionTone = (a: string) => (a === "block" ? "red" : a === "warn" ? "amber" : "");

export function Dlp({ app, tab }: { app: AppCtx; tab: string | null }) {
  const t: Tab = (TABS.find(([k]) => k === tab)?.[0]) ?? "rules";
  const [d, setD] = useState<Data | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const load = useCallback(() => {
    void api<Data>("/api/dlp").then(setD).catch((e) => app.say(e.message));
    void api<{ open: number }>("/api/dlp/incidents?status=open").then((r) => setOpen(r.open)).catch(() => {});
  }, [app]);
  useEffect(load, [load]);

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Data loss prevention</h1>
          <p className="muted">Stop or flag sensitive information such as card numbers, SSNs and keys before it leaves through {CHECKING.map((a) => appLabel(app, a)).join(", ")}.</p>
        </div>
      </div>
      <nav className="tabs" aria-label="Data loss prevention">
        {TABS.map(([k, text]) => (
          <a key={k} href={`#/dlp/${k}`} className={t === k ? "on" : ""} aria-current={t === k ? "page" : undefined}>
            {text}
            {k === "alerts" && open ? <span className="count">{open}</span> : null}
            {k === "rules" && d ? <span className="count">{d.rules.length}</span> : null}
          </a>
        ))}
      </nav>
      {!d ? <p className="muted">Loading…</p>
        : t === "rules" ? <Rules app={app} d={d} reload={load} />
        : t === "alerts" ? <Alerts app={app} labels={d.labels} onChange={load} />
        : t === "types" ? <Types app={app} d={d} reload={load} />
        : <TryIt app={app} d={d} />}
    </div>
  );
}

// ---------- rules ----------

function Rules({ app, d, reload }: { app: AppCtx; d: Data; reload: () => void }) {
  const [editing, setEditing] = useState<RuleRecord | Omit<DlpRule, "id"> | null>(null);
  const [removing, setRemoving] = useState<RuleRecord | null>(null);
  const [domains, setDomains] = useState(false);
  const typeName = (id: string) => d.types.find((t) => t.id === id)?.name ?? id;
  const blank: Omit<DlpRule, "id"> = { name: "", enabled: true, mode: "test", apps: [], types: [{ type: "credit-card", min: 1 }], labels: [], scope: "external", action: "warn", tip: "" };
  return (
    <>
      <div className="toolbar">
        <button className="btn primary" onClick={() => setEditing(blank)}><Plus size={16} /> New rule</button>
        <select aria-label="Start from a template" value="" onChange={(e) => { const tpl = d.templates[Number(e.target.value)]; if (tpl) setEditing({ ...tpl }); }}>
          <option value="">Start from a template…</option>
          {d.templates.map((tpl, i) => <option key={tpl.name} value={i}>{tpl.name}</option>)}
        </select>
        <span className="grow" />
        <span className="muted small">Inside the company: {d.internalDomains.length ? d.internalDomains.join(", ") : <strong>no domains yet, so every recipient counts as outside</strong>}</span>
        <button className="btn small" onClick={() => setDomains(true)}>Change</button>
      </div>
      {!d.rules.some((r) => r.enabled && r.mode === "enforce") ? (
        <div className="notice"><ShieldAlert size={16} /><div><p>No rule is enforced yet. New rules start in test mode: they record alerts without stopping anyone, so you can see what they would catch before turning them on.</p></div></div>
      ) : null}
      <section className="panel flush">
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Rule</th><th>Looks for</th><th>When</th><th>Action</th><th>Status</th><th /></tr></thead>
            <tbody>
              {!d.rules.length ? <tr><td colSpan={6}><div className="empty"><p>No rules: nothing is checked. Start from a template to cover common financial and personal information.</p></div></td></tr>
                : d.rules.map((r) => (
                  <tr key={r.id}>
                    <td><div className="cellstack"><span className="rname">{r.name}</span><span className="rsub">{appsText(app, r.apps)}</span></div></td>
                    <td>
                      <div className="chips">
                        {r.types.map((t) => <span key={t.type} className="chip plain">{typeName(t.type)}{t.min > 1 ? ` ×${t.min}+` : ""}</span>)}
                        {r.labels.map((id) => { const l = d.labels.find((x) => x.id === id); return l ? <LabelChip key={id} label={l} /> : <span key={id} className="chip plain muted">Deleted label</span>; })}
                      </div>
                    </td>
                    <td>{r.scope === "external" ? "Leaving the company" : "Anywhere"}</td>
                    <td><Badge tone={actionTone(r.action)}>{ACTION_TEXT[r.action]}</Badge></td>
                    <td>{!r.enabled ? <Badge>Off</Badge> : r.mode === "test" ? <Badge tone="purple">Testing</Badge> : <Badge tone="green">On</Badge>}</td>
                    <td className="num nowrap">
                      <button className="btn small" onClick={() => setEditing(r)}>Change</button>{" "}
                      <button className="iconbtn small" aria-label="Delete rule" title="Delete rule" onClick={() => setRemoving(r)}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      {editing ? <RuleEditor app={app} d={d} rule={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); app.say("Rule saved"); reload(); }} /> : null}
      {domains ? <DomainsEditor d={d} onClose={() => setDomains(false)} onSaved={() => { setDomains(false); app.say("Domains saved"); reload(); }} /> : null}
      {removing ? (
        <Confirm
          title="Delete this rule?"
          action="Delete rule"
          danger
          message={<>Apps stop checking <strong>{removing.name}</strong> within about a minute. Its alerts stay.</>}
          onConfirm={async () => {
            try {
              await api(`/api/dlp/rules/${removing.id}`, { method: "DELETE" });
              app.say("Rule deleted");
              reload();
            } catch (e) {
              app.say((e as Error).message);
            }
          }}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </>
  );
}

function RuleEditor({ app, d, rule, onClose, onSaved }: { app: AppCtx; d: Data; rule: RuleRecord | Omit<DlpRule, "id">; onClose: () => void; onSaved: () => void }) {
  const id = "id" in rule ? rule.id : null;
  const [r, setR] = useState<Omit<DlpRule, "id">>({ ...rule, types: rule.types.map((t) => ({ ...t })), apps: [...rule.apps], labels: [...rule.labels] });
  const [error, setError] = useState("");
  const set = (patch: Partial<Omit<DlpRule, "id">>) => setR((x) => ({ ...x, ...patch }));
  const unused = d.types.filter((t) => !r.types.some((x) => x.type === t.id));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <Modal title={id ? "Change rule" : "New rule"} onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api(id ? `/api/dlp/rules/${id}` : "/api/dlp", { method: id ? "PUT" : "POST", json: r });
            onSaved();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <label><span>Name</span><input value={r.name} onChange={(e) => set({ name: e.target.value })} maxLength={100} required autoFocus /></label>
        <fieldset>
          <legend>Look for any of these</legend>
          {r.types.map((t, i) => (
            <div key={t.type} className="toolbar">
              <span className="grow">{d.types.find((x) => x.id === t.type)?.name ?? t.type}</span>
              <label className="check small" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                at least
                <input type="number" min={1} max={10000} value={t.min} style={{ width: 80 }} onChange={(e) => set({ types: r.types.map((x, j) => (j === i ? { ...x, min: Math.max(1, Number(e.target.value) || 1) } : x)) })} />
                different
              </label>
              <button type="button" className="iconbtn small" aria-label="Remove" onClick={() => set({ types: r.types.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
            </div>
          ))}
          {unused.length ? (
            <select value="" aria-label="Add a type" onChange={(e) => e.target.value && set({ types: [...r.types, { type: e.target.value, min: 1 }] })}>
              <option value="">Add a kind of sensitive information…</option>
              {unused.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          ) : null}
          {d.labels.length ? (
            <div>
              <span className="muted small">…or content with these labels</span>
              <div className="chips" style={{ marginTop: 4 }}>
                {d.labels.map((l) => (
                  <label key={l.id} className="check" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={r.labels.includes(l.id)} onChange={() => set({ labels: toggle(r.labels, l.id) })} /> <LabelChip label={l} />
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </fieldset>
        <div className="grid2">
          <label>
            <span>When</span>
            <select value={r.scope} onChange={(e) => set({ scope: e.target.value as DlpRule["scope"] })}>
              <option value="external">It would leave the company</option>
              <option value="anyone">Shared with anyone, inside or out</option>
            </select>
          </label>
          <label>
            <span>Then</span>
            <select value={r.action} onChange={(e) => set({ action: e.target.value as DlpRule["action"] })}>
              <option value="block">Block it</option>
              <option value="warn">Warn; allow with a reason</option>
              <option value="audit">Allow and record an alert</option>
            </select>
          </label>
        </div>
        <div>
          <span className="muted small">Apps (none ticked = every app that checks: {CHECKING.map((a) => appLabel(app, a)).join(", ")})</span>
          <div className="appchecks" style={{ marginTop: 4 }}>
            {CHECKING.map((a) => (
              <label key={a} className="check"><input type="checkbox" checked={r.apps.includes(a)} onChange={() => set({ apps: toggle(r.apps, a) })} /> {appLabel(app, a)}</label>
            ))}
          </div>
        </div>
        <label><span>Message people see (optional)</span><textarea rows={2} value={r.tip ?? ""} onChange={(e) => set({ tip: e.target.value })} maxLength={500} placeholder="A clear message is written for you when this is empty" /></label>
        <div className="seg" role="radiogroup" aria-label="Mode">
          <button type="button" role="radio" aria-checked={r.enabled && r.mode === "test"} className={r.enabled && r.mode === "test" ? "on" : ""} onClick={() => set({ enabled: true, mode: "test" })}>Test: record alerts only</button>
          <button type="button" role="radio" aria-checked={r.enabled && r.mode === "enforce"} className={r.enabled && r.mode === "enforce" ? "on" : ""} onClick={() => set({ enabled: true, mode: "enforce" })}>On</button>
          <button type="button" role="radio" aria-checked={!r.enabled} className={!r.enabled ? "on" : ""} onClick={() => set({ enabled: false })}>Off</button>
        </div>
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save rule</button>
        </div>
      </form>
    </Modal>
  );
}

function DomainsEditor({ d, onClose, onSaved }: { d: Data; onClose: () => void; onSaved: () => void }) {
  const fixed = d.internalDomains.filter((x) => !d.extraDomains.includes(x));
  const [v, setV] = useState(d.extraDomains.join("\n"));
  const [error, setError] = useState("");
  return (
    <Modal title="Domains inside the company" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/api/dlp/domains", { method: "PUT", json: { domains: v } });
            onSaved();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <p>Recipients at these domains (and their subdomains) are inside the company. Everyone else is outside.</p>
        {fixed.length ? <p className="muted small">Always inside: {fixed.join(", ")} (the suite&apos;s own mail domain).</p> : null}
        <label><span>Other domains, one per line</span><textarea rows={5} value={v} onChange={(e) => setV(e.target.value)} placeholder="subsidiary.example" /></label>
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- alerts ----------

function Alerts({ app, labels, onChange }: { app: AppCtx; labels: SensitivityLabel[]; onChange: () => void }) {
  const [status, setStatus] = useState("open");
  const [rows, setRows] = useState<IncidentRecord[] | null>(null);
  const [more, setMore] = useState(false);
  const [sel, setSel] = useState<IncidentRecord | null>(null);
  const load = useCallback((before?: string) => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (before) p.set("before", before);
    void api<{ incidents: IncidentRecord[]; more: boolean }>(`/api/dlp/incidents?${p}`).then((r) => {
      setRows((x) => (before && x ? [...x, ...r.incidents] : r.incidents));
      setMore(r.more);
    }).catch((e) => app.say(e.message));
  }, [app, status]);
  useEffect(() => load(), [load]);
  return (
    <>
      <div className="toolbar">
        <div className="seg" role="radiogroup" aria-label="Status">
          {[["open", "Open"], ["resolved", "Resolved"], ["dismissed", "Dismissed"], ["", "All"]].map(([k, text]) => (
            <button key={k} role="radio" aria-checked={status === k} className={status === k ? "on" : ""} onClick={() => setStatus(k)}>{text}</button>
          ))}
        </div>
      </div>
      <section className="panel flush">
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Found</th><th>Outcome</th></tr></thead>
            <tbody>
              {!rows ? <tr><td colSpan={5} className="muted">Loading…</td></tr>
                : !rows.length ? <tr><td colSpan={5}><div className="empty"><p>No alerts here.</p></div></td></tr>
                : rows.map((r) => (
                  <tr key={r.id} className={`click${sel?.id === r.id ? " sel" : ""}`} onClick={() => setSel(r)}>
                    <td className="nowrap">{formatDateTime(r.at)}</td>
                    <td className="clip">{r.actor}</td>
                    <td><div className="cellstack"><span className="clip">{r.title || "(untitled)"}</span><span className="rsub">{appLabel(app, r.app)}{r.recipients.length ? ` · to ${plural(r.recipients.length, "recipient")}` : ""}</span></div></td>
                    <td className="clip">{r.matches.map((m) => `${m.name} (${m.count})`).join(", ") || (r.labelId ? labels.find((l) => l.id === r.labelId)?.name ?? "Label" : "—")}</td>
                    <td>
                      <Badge tone={actionTone(r.action)}>{r.action === "block" ? "Blocked" : r.action === "warn" ? (r.overridden ? "Sent anyway" : "Warned") : "Recorded"}</Badge>
                      {r.rules.some((x) => x.mode === "test") ? <> <Badge tone="purple">Test</Badge></> : null}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {more && rows?.length ? <div className="pad"><button className="btn small" onClick={() => load(rows[rows.length - 1].id)}>Show more</button></div> : null}
      </section>
      {sel ? <AlertView app={app} r={sel} labels={labels} onClose={() => setSel(null)} onSaved={(x) => { setSel(null); setRows((rs) => rs?.map((y) => (y.id === x.id ? x : y)).filter((y) => !status || y.status === status) ?? null); onChange(); }} /> : null}
    </>
  );
}

function AlertView({ app, r, labels, onClose, onSaved }: { app: AppCtx; r: IncidentRecord; labels: SensitivityLabel[]; onClose: () => void; onSaved: (r: IncidentRecord) => void }) {
  const [note, setNote] = useState(r.note);
  const [error, setError] = useState("");
  const label = r.labelId ? labels.find((l) => l.id === r.labelId) : null;
  const set = async (status: string) => {
    try {
      onSaved(await api<IncidentRecord>(`/api/dlp/incidents/${r.id}`, { method: "PATCH", json: { status, note } }));
    } catch (x) {
      setError((x as Error).message);
    }
  };
  return (
    <Modal title="Data loss prevention alert" onClose={onClose} wide>
      <div className="form">
        <dl className="facts">
          <div><dt>When</dt><dd>{formatDateTime(r.at)}</dd></div>
          <div><dt>Who</dt><dd>{r.actor}</dd></div>
          <div><dt>App</dt><dd>{appLabel(app, r.app)}</dd></div>
          <div><dt>Outcome</dt><dd>{r.action === "block" ? "Blocked" : r.action === "warn" ? (r.overridden ? "Warned, sent anyway" : "Warned, not sent") : "Allowed and recorded"}</dd></div>
          <div><dt>What</dt><dd>{r.title || "(untitled)"}</dd></div>
          {label ? <div><dt>Label</dt><dd><LabelChip label={label} /></dd></div> : null}
        </dl>
        {r.overridden && r.justification ? <div className="notice warn"><AlertTriangle size={16} /><div><p><strong>Reason given:</strong> {r.justification}</p></div></div> : null}
        <div>
          <strong>Rules</strong>
          <ul>{r.rules.map((x) => <li key={x.id}>{x.name} <Badge tone={actionTone(x.action)}>{x.mode === "test" ? "Test" : ACTION_TEXT[x.action]}</Badge></li>)}</ul>
        </div>
        {r.matches.length ? <div><strong>Found</strong><ul>{r.matches.map((m) => <li key={m.type}>{m.name}: {m.count}</li>)}</ul></div> : null}
        {r.recipients.length ? <div><strong>Recipients</strong><p className="pre small">{r.recipients.join(", ")}</p></div> : null}
        <label><span>Note</span><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></label>
        {r.resolvedBy ? <p className="muted small">{r.status === "resolved" ? "Resolved" : "Dismissed"} by {r.resolvedBy}, {formatDateTime(r.resolvedAt)}</p> : null}
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          {r.status !== "open" ? <button className="btn" onClick={() => void set("open")}>Reopen</button> : null}
          {r.status !== "dismissed" ? <button className="btn" onClick={() => void set("dismissed")}>Dismiss</button> : null}
          {r.status !== "resolved" ? <button className="btn primary" onClick={() => void set("resolved")}>Resolve</button> : <button className="btn primary" onClick={() => void set("resolved")}>Save note</button>}
        </div>
      </div>
    </Modal>
  );
}

// ---------- types ----------

function Types({ app, d, reload }: { app: AppCtx; d: Data; reload: () => void }) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<CustomInfoType | null>(null);
  const custom = new Set(d.customTypes.map((t) => t.id));
  return (
    <>
      <div className="toolbar"><button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> New type</button></div>
      <section className="panel flush">
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Type</th><th>How it&apos;s found</th><th /></tr></thead>
            <tbody>
              {d.types.map((t) => {
                const c = d.customTypes.find((x) => x.id === t.id);
                return (
                  <tr key={t.id}>
                    <td><div className="cellstack"><span className="rname">{t.name}</span>{custom.has(t.id) ? <span className="rsub">Custom</span> : <span className="rsub">Built in</span>}</div></td>
                    <td className="small">{c ? [c.keywords?.length ? `Keywords: ${c.keywords.join(", ")}` : "", c.pattern ? `Pattern: ${c.pattern}` : ""].filter(Boolean).join(" · ") : t.description ?? ""}</td>
                    <td className="num">{c ? <button className="iconbtn small" aria-label="Delete type" title="Delete type" onClick={() => setRemoving(c)}><Trash2 size={14} /></button> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {adding ? <TypeEditor onClose={() => setAdding(false)} onSaved={() => { setAdding(false); app.say("Type saved"); reload(); }} /> : null}
      {removing ? (
        <Confirm
          title="Delete this type?"
          action="Delete type"
          danger
          message={<>Rules can no longer look for <strong>{removing.name}</strong>.</>}
          onConfirm={async () => {
            try {
              await api(`/api/dlp/types/${encodeURIComponent(removing.id)}`, { method: "DELETE" });
              app.say("Type deleted");
              reload();
            } catch (e) {
              app.say((e as Error).message);
            }
          }}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </>
  );
}

function TypeEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState("");
  return (
    <Modal title="New sensitive information type" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await api("/api/dlp/types", { method: "POST", json: { name: f.get("name"), description: f.get("description"), keywords: f.get("keywords"), pattern: f.get("pattern") } });
            onSaved();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <label><span>Name</span><input name="name" maxLength={80} required autoFocus placeholder="e.g. Project Falcon or Employee ID" /></label>
        <label><span>Description (optional)</span><input name="description" maxLength={300} /></label>
        <label><span>Keywords or phrases, one per line (whole words, any case)</span><textarea name="keywords" rows={4} /></label>
        <label><span>…or a pattern (regular expression, any case)</span><input name="pattern" maxLength={500} placeholder={"e.g. EMP-\\d{6}"} /></label>
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save type</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- try it ----------

function TryIt({ app, d }: { app: AppCtx; d: Data }) {
  const [text, setText] = useState("");
  const [recipients, setRecipients] = useState("");
  const [appId, setAppId] = useState("mail");
  const [labelId, setLabelId] = useState("");
  const [out, setOut] = useState<DlpDecision | null>(null);
  return (
    <div className="panel">
      <form
        className="form"
        style={{ padding: 0 }}
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            setOut(await api<DlpDecision>("/api/dlp/test", { method: "POST", json: { text, recipients, app: appId, labelId } }));
          } catch (x) {
            app.say((x as Error).message);
          }
        }}
      >
        <p className="muted">Paste some text to see what the current rules would do. Nothing is recorded.</p>
        <label><span>Text</span><textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Card 4111 1111 1111 1111" /></label>
        <div className="grid2">
          <label><span>Recipients</span><input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="someone@outside.example" /></label>
          <label>
            <span>App</span>
            <select value={appId} onChange={(e) => setAppId(e.target.value)}>{CHECKING.map((a) => <option key={a} value={a}>{appLabel(app, a)}</option>)}</select>
          </label>
        </div>
        <label>
          <span>Label</span>
          <select value={labelId} onChange={(e) => setLabelId(e.target.value)}>
            <option value="">No label</option>
            {d.labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <div className="actions"><button className="btn primary"><FlaskConical size={16} /> Check</button></div>
      </form>
      {out ? (
        <div className={`notice ${out.action === "block" ? "danger" : out.action === "warn" ? "warn" : out.action === "audit" ? "" : "ok"}`} style={{ marginTop: 12 }}>
          <div>
            <p><strong>{out.action === "allow" ? "Allowed: no rule matched." : out.action === "audit" ? "Allowed, and an alert would be recorded." : out.action === "warn" ? "The person would be warned and could go ahead with a reason." : "Blocked."}</strong></p>
            {out.tip ? <p>They&apos;d see: “{out.tip}”</p> : null}
            {out.matches.length ? <p>Found: {out.matches.map((m) => `${m.name} ×${m.count} (${m.samples.join(", ")})`).join("; ")}</p> : null}
            {out.rules.length ? <p>Rules: {out.rules.map((r) => `${r.name}${r.mode === "test" ? " (test)" : ""}`).join(", ")}</p> : null}
            {out.outside.length ? <p>Outside the company: {out.outside.join(", ")}</p> : out.external ? <p>Treated as leaving the company.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
