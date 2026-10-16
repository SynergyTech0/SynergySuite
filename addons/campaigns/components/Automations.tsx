"use client";
// Automations: an email sent a while after someone joins an audience or gets a tag.
import { ArrowLeft, Plus, Trash2, Workflow } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Audience, Automation } from "@/lib/types";
import { api, num, type AppCtx } from "./client";
import { EmailEditor, type Email } from "./EmailEditor";
import { Modal } from "./Modal";

export function AutomationsView({ ctx, id }: { ctx: AppCtx; id: string | null }) {
  if (id) return <AutomationEditor ctx={ctx} id={id} />;
  return <AutomationList ctx={ctx} />;
}

function delayText(m: number): string {
  if (!m) return "right away";
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? "" : "s"} later`;
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? "" : "s"} later`;
  return `${m} minutes later`;
}

function AutomationList({ ctx }: { ctx: AppCtx }) {
  const [list, setList] = useState<Automation[] | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    void api<Automation[]>("/api/automations").then(setList).catch((e) => ctx.say(e.message));
  }, [ctx]);
  return (
    <div className="page">
      <div className="pagehead">
        <h1>Automations</h1>
        {ctx.canEdit && <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> New automation</button>}
      </div>
      {!list ? (
        <div className="empty">Loading…</div>
      ) : !list.length ? (
        <div className="empty"><Workflow size={28} /><p>No automations yet. A welcome email to everyone who joins is a good first one.</p></div>
      ) : (
        <table className="table">
          <thead><tr><th>Name</th><th>When</th><th>Status</th><th className="num">Sent</th><th className="num">Waiting</th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className="click" onClick={() => ctx.go({ view: "automations", id: a.id })}>
                <td><strong>{a.name}</strong></td>
                <td className="small">{a.trigger === "tagged" ? `Tagged “${a.tag}”` : "Joins"} {a.audienceName ?? "a deleted audience"}, {delayText(a.delayMinutes)}</td>
                <td>{a.active ? <span className="badge green">On</span> : <span className="badge">Off</span>}</td>
                <td className="num">{num(a.sent)}</td>
                <td className="num">{num(a.waiting)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {creating && <NewAutomation ctx={ctx} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewAutomation({ ctx, onClose }: { ctx: AppCtx; onClose: () => void }) {
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => {
    void api<Audience[]>("/api/audiences").then(setAudiences).catch(() => {});
  }, []);
  return (
    <Modal title="New automation" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            const a = await api<Automation>("/api/automations", {
              method: "POST",
              json: { name: f.get("name"), audienceId: f.get("audienceId"), subject: "Welcome, {{first_name|default: friend}}", blocks: [{ type: "heading", text: "Welcome!" }, { type: "text", text: "Thanks for joining." }] },
            });
            ctx.go({ view: "automations", id: a.id });
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <label><span>Name</span><input name="name" required autoFocus defaultValue="Welcome email" /></label>
        <label>
          <span>Audience</span>
          <select name="audienceId" required defaultValue="">
            <option value="" disabled>Pick an audience</option>
            {audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <p className="error">{err}</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Create</button></div>
      </form>
    </Modal>
  );
}

function AutomationEditor({ ctx, id }: { ctx: AppCtx; id: string }) {
  const [a, setA] = useState<Automation | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [email, setEmail] = useState<Email | null>(null);
  const [meta, setMeta] = useState({ name: "", trigger: "subscribed" as "subscribed" | "tagged", tag: "", delay: 0, unit: 1 });
  const [dirty, setDirty] = useState(false);
  const load = useCallback(() => {
    void api<Automation>(`/api/automations/${id}`)
      .then((x) => {
        setA(x);
        const unit = x.delayMinutes && x.delayMinutes % 1440 === 0 ? 1440 : x.delayMinutes && x.delayMinutes % 60 === 0 ? 60 : 1;
        setMeta({ name: x.name, trigger: x.trigger, tag: x.tag, delay: x.delayMinutes / unit, unit });
        setEmail({ subject: x.subject, preheader: x.preheader, blocks: x.blocks });
        void api<{ tags: string[] }>(`/api/audiences/${x.audienceId}`).then((d) => setTags(d.tags)).catch(() => {});
      })
      .catch((e) => ctx.say(e.message));
  }, [id, ctx]);
  useEffect(load, [load]);
  const save = useCallback(async (extra: Record<string, unknown> = {}) => {
    if (!email) return;
    try {
      const x = await api<Automation>(`/api/automations/${id}`, {
        method: "PATCH",
        json: { name: meta.name, trigger: meta.trigger, tag: meta.tag, delayMinutes: Math.round(meta.delay * meta.unit), ...email, ...extra },
      });
      setA(x);
      setDirty(false);
    } catch (e) {
      ctx.say((e as Error).message);
    }
  }, [id, meta, email, ctx]);
  useEffect(() => {
    if (!dirty || !ctx.canEdit) return;
    const t = window.setTimeout(() => void save(), 1500);
    return () => window.clearTimeout(t);
  }, [dirty, save, ctx.canEdit]);
  if (!a || !email) return <div className="empty">Loading…</div>;
  const change = (m: Partial<typeof meta>) => {
    setMeta({ ...meta, ...m });
    setDirty(true);
  };
  return (
    <div className="page">
      <div className="pagehead">
        <div className="toolbar">
          <button className="btn ghost" onClick={() => ctx.go({ view: "automations" })}><ArrowLeft size={16} /> Automations</button>
          {a.active ? <span className="badge green">On</span> : <span className="badge">Off</span>}
          <span className="small muted">{num(a.sent)} sent · {num(a.waiting)} waiting · {dirty ? "Unsaved changes" : "Saved"}</span>
        </div>
        {ctx.canEdit && (
          <div className="toolbar">
            <button className="btn" onClick={async () => { if (confirm("Delete this automation?")) { await api(`/api/automations/${id}`, { method: "DELETE" }); ctx.go({ view: "automations" }); } }}><Trash2 size={15} /> Delete</button>
            <button className={`btn ${a.active ? "" : "primary"}`} onClick={() => save({ active: !a.active })}>{a.active ? "Turn off" : "Turn on"}</button>
          </div>
        )}
      </div>
      <div className="panel">
        <div className="grid2">
          <label className="field"><span>Name</span><input value={meta.name} disabled={!ctx.canEdit} onChange={(e) => change({ name: e.target.value })} /></label>
          <div className="field"><span>Audience</span><div>{a.audienceName}</div></div>
          <label className="field">
            <span>Starts when someone</span>
            <select value={meta.trigger} disabled={!ctx.canEdit} onChange={(e) => change({ trigger: e.target.value === "tagged" ? "tagged" : "subscribed" })}>
              <option value="subscribed">joins the audience</option>
              <option value="tagged">is given a tag</option>
            </select>
          </label>
          {meta.trigger === "tagged" && (
            <label className="field">
              <span>Tag</span>
              <input list="automation-tags" value={meta.tag} disabled={!ctx.canEdit} onChange={(e) => change({ tag: e.target.value })} />
              <datalist id="automation-tags">{tags.map((t) => <option key={t} value={t} />)}</datalist>
            </label>
          )}
          <label className="field">
            <span>Send</span>
            <div className="row">
              <input type="number" min={0} value={meta.delay} disabled={!ctx.canEdit} onChange={(e) => change({ delay: Math.max(0, Number(e.target.value)) })} style={{ width: 90 }} />
              <select value={meta.unit} disabled={!ctx.canEdit} onChange={(e) => change({ unit: Number(e.target.value) })}>
                <option value={1}>minutes later</option><option value={60}>hours later</option><option value={1440}>days later</option>
              </select>
            </div>
          </label>
        </div>
        <p className="small muted" style={{ margin: "10px 0 0" }}>Each person gets it once. Only people who join or get the tag while it is on are included.</p>
      </div>
      <EmailEditor value={email} ai={ctx.ai} readOnly={!ctx.canEdit} onChange={(v) => { setEmail(v); setDirty(true); }} />
    </div>
  );
}
