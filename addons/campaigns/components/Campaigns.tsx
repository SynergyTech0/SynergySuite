"use client";
// Campaigns: the list, a draft's editor (audience, sender, the email, test and send), and once it
// has gone out, its report.
import { ArrowLeft, Copy, Pause, Play, Plus, Send, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { LinkStat, RecipientRow } from "@/lib/campaigns";
import type { Audience, Campaign, Segment, Template } from "@/lib/types";
import { label } from "@/lib/types";
import { api, formatDateTime, num, pct, toLocalInput, type AppCtx } from "./client";
import { EmailEditor, type Email } from "./EmailEditor";
import { Modal } from "./Modal";

const BADGE: Record<string, string> = { draft: "", scheduled: "blue", sending: "amber", paused: "amber", sent: "green", canceled: "red" };

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${BADGE[status] ?? ""}`}>{label(status)}</span>;
}

export function CampaignsView({ ctx, id, tab }: { ctx: AppCtx; id: string | null; tab: string | null }) {
  if (id) return <CampaignDetail ctx={ctx} id={id} tab={tab} />;
  return <CampaignList ctx={ctx} />;
}

function CampaignList({ ctx }: { ctx: AppCtx }) {
  const [list, setList] = useState<Campaign[] | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    void api<Campaign[]>("/api/campaigns").then(setList).catch((e) => ctx.say(e.message));
  }, [ctx]);
  return (
    <div className="page">
      <div className="pagehead">
        <h1>Campaigns</h1>
        {ctx.canEdit && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New campaign
          </button>
        )}
      </div>
      {!list ? (
        <div className="empty">Loading…</div>
      ) : !list.length ? (
        <div className="empty">
          <Send size={28} />
          <p>No campaigns yet. Make one to email an audience.</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Status</th><th>Audience</th><th>When</th><th className="num">Recipients</th><th className="num">Opened</th><th className="num">Clicked</th></tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className="click" onClick={() => ctx.go({ view: "campaigns", id: c.id })}>
                <td className="trunc"><strong>{c.name}</strong><div className="rsub">{c.subject || "(no subject)"}</div></td>
                <td><StatusBadge status={c.status} /></td>
                <td className="trunc">{c.audienceName ?? "—"}{c.segmentName ? ` · ${c.segmentName}` : ""}</td>
                <td>{formatDateTime(c.startedAt ?? c.scheduledAt ?? c.updatedAt)}</td>
                <td className="num">{c.stats ? num(c.stats.recipients) : "—"}</td>
                <td className="num">{c.stats ? pct(c.stats.uniqueOpens, c.stats.sent) : "—"}</td>
                <td className="num">{c.stats ? pct(c.stats.uniqueClicks, c.stats.sent) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {creating && <NewCampaign ctx={ctx} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewCampaign({ ctx, onClose }: { ctx: AppCtx; onClose: () => void }) {
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => {
    void api<Audience[]>("/api/audiences").then(setAudiences).catch(() => {});
    void api<Template[]>("/api/templates").then(setTemplates).catch(() => {});
  }, []);
  return (
    <Modal title="New campaign" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            const c = await api<Campaign>("/api/campaigns", { method: "POST", json: { name: f.get("name"), audienceId: f.get("audienceId"), templateId: f.get("templateId") } });
            ctx.go({ view: "campaigns", id: c.id });
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <label><span>Name (only your team sees it)</span><input name="name" required autoFocus maxLength={160} /></label>
        <label>
          <span>Audience</span>
          <select name="audienceId" defaultValue="">
            <option value="">Pick later</option>
            {audiences.map((a) => <option key={a.id} value={a.id}>{a.name} ({num(a.counts.subscribed)})</option>)}
          </select>
        </label>
        <label>
          <span>Start from</span>
          <select name="templateId" defaultValue="">
            <option value="">A blank email</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <p className="error">{err}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Create</button>
        </div>
      </form>
    </Modal>
  );
}

type Readiness = { problems: string[]; recipients: number };

function CampaignDetail({ ctx, id, tab }: { ctx: AppCtx; id: string; tab: string | null }) {
  const [c, setC] = useState<Campaign | null>(null);
  const [ready, setReady] = useState<Readiness | null>(null);
  const load = useCallback(() => {
    void api<{ campaign: Campaign; readiness: Readiness | null }>(`/api/campaigns/${id}`)
      .then((r) => {
        setC(r.campaign);
        setReady(r.readiness);
      })
      .catch((e) => ctx.say(e.message));
  }, [id, ctx]);
  useEffect(load, [load]);

  // A running send refreshes itself.
  useEffect(() => {
    if (c?.status !== "sending") return;
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, [c?.status, load]);

  if (!c) return <div className="empty">Loading…</div>;
  const back = (
    <button className="btn ghost" onClick={() => ctx.go({ view: "campaigns" })}>
      <ArrowLeft size={16} /> Campaigns
    </button>
  );
  if (c.status === "draft" && tab !== "report") return <DraftEditor ctx={ctx} c={c} ready={ready} reload={load} back={back} />;
  return <Report ctx={ctx} c={c} reload={load} back={back} />;
}

function DraftEditor({ ctx, c, ready, reload, back }: { ctx: AppCtx; c: Campaign; ready: Readiness | null; reload: () => void; back: React.ReactNode }) {
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [meta, setMeta] = useState({ name: c.name, audienceId: c.audienceId ?? "", segmentId: c.segmentId ?? "", fromName: c.fromName, replyTo: c.replyTo });
  const [email, setEmail] = useState<Email>({ subject: c.subject, preheader: c.preheader, blocks: c.blocks });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<"test" | "send" | null>(null);

  useEffect(() => {
    void api<Audience[]>("/api/audiences").then(setAudiences).catch(() => {});
  }, []);
  useEffect(() => {
    if (!meta.audienceId) return setSegments([]);
    void api<{ segments: Segment[] }>(`/api/audiences/${meta.audienceId}`).then((r) => setSegments(r.segments)).catch(() => setSegments([]));
  }, [meta.audienceId]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await api(`/api/campaigns/${c.id}`, { method: "PATCH", json: { ...meta, segmentId: meta.segmentId || null, audienceId: meta.audienceId || null, ...email } });
      setDirty(false);
      reload();
      return true;
    } catch (e) {
      ctx.say((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }, [c.id, meta, email, reload, ctx]);

  // Saves a moment after the last change.
  useEffect(() => {
    if (!dirty || !ctx.canEdit) return;
    const t = window.setTimeout(() => void save(), 1500);
    return () => window.clearTimeout(t);
  }, [dirty, save, ctx.canEdit]);

  const change = (m: Partial<typeof meta>) => {
    setMeta((x) => ({ ...x, ...m }));
    setDirty(true);
  };

  return (
    <div className="page">
      <div className="pagehead">
        <div className="toolbar">{back}<StatusBadge status={c.status} /><span className="small muted">{saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}</span></div>
        {ctx.canEdit && (
          <div className="toolbar">
            <button className="btn" onClick={async () => { const d = await api<Campaign>(`/api/campaigns/${c.id}/action`, { method: "POST", json: { action: "duplicate" } }); ctx.go({ view: "campaigns", id: d.id }); }}>
              <Copy size={15} /> Duplicate
            </button>
            <button className="btn" onClick={async () => { if (confirm("Delete this draft?")) { await api(`/api/campaigns/${c.id}`, { method: "DELETE" }); ctx.go({ view: "campaigns" }); } }}>
              <Trash2 size={15} /> Delete
            </button>
            <button className="btn" onClick={async () => (await save()) && setDialog("test")}>Send a test</button>
            <button className="btn primary" onClick={async () => (await save()) && setDialog("send")}><Send size={15} /> Send or schedule</button>
          </div>
        )}
      </div>
      <div className="panel">
        <div className="grid2">
          <label className="field"><span>Campaign name</span><input value={meta.name} disabled={!ctx.canEdit} onChange={(e) => change({ name: e.target.value })} /></label>
          <label className="field">
            <span>To</span>
            <select value={meta.audienceId} disabled={!ctx.canEdit} onChange={(e) => change({ audienceId: e.target.value, segmentId: "" })}>
              <option value="">Pick an audience</option>
              {audiences.map((a) => <option key={a.id} value={a.id}>{a.name} ({num(a.counts.subscribed)} subscribed)</option>)}
            </select>
          </label>
          <label className="field">
            <span>Segment</span>
            <select value={meta.segmentId} disabled={!ctx.canEdit || !meta.audienceId} onChange={(e) => change({ segmentId: e.target.value })}>
              <option value="">Everyone subscribed</option>
              {segments.map((s) => <option key={s.id} value={s.id}>{s.name} ({num(s.count ?? 0)})</option>)}
            </select>
          </label>
          <label className="field"><span>From name</span><input value={meta.fromName} placeholder={ctx.settings.fromName || "Your organization"} disabled={!ctx.canEdit} onChange={(e) => change({ fromName: e.target.value })} /></label>
          <label className="field"><span>Reply-To</span><input value={meta.replyTo} placeholder={ctx.settings.replyTo || ctx.settings.fromEmail} disabled={!ctx.canEdit} onChange={(e) => change({ replyTo: e.target.value })} /></label>
          <div className="field"><span>From address</span><div>{ctx.settings.fromEmail || <span className="muted">Not set (Settings)</span>}</div></div>
        </div>
        {ready && (
          <p className="small" style={{ margin: "10px 0 0" }}>
            {ready.problems.length ? (
              <span className="error">Before sending: {ready.problems.join(". ")}.</span>
            ) : (
              <span className="ok">Ready to send to {num(ready.recipients)} {ready.recipients === 1 ? "person" : "people"}.</span>
            )}
          </p>
        )}
      </div>
      <EmailEditor value={email} ai={ctx.ai} readOnly={!ctx.canEdit} onChange={(v) => { setEmail(v); setDirty(true); }} />
      {dialog === "test" && <TestDialog ctx={ctx} id={c.id} onClose={() => setDialog(null)} />}
      {dialog === "send" && <SendDialog ctx={ctx} c={c} ready={ready} onClose={() => setDialog(null)} onDone={reload} />}
    </div>
  );
}

function TestDialog({ ctx, id, onClose }: { ctx: AppCtx; id: string; onClose: () => void }) {
  const [err, setErr] = useState("");
  return (
    <Modal title="Send a test" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await api<{ sent: string[]; failed: { to: string; reason: string }[] }>(`/api/campaigns/${id}/action`, {
              method: "POST", json: { action: "test", to: new FormData(e.currentTarget).get("to") },
            });
            if (r.failed.length) setErr(r.failed.map((f) => `${f.to}: ${f.reason}`).join("; "));
            else {
              ctx.say(`Test sent to ${r.sent.join(", ")}`);
              onClose();
            }
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <label><span>Send to (up to five, separated by commas)</span><input name="to" defaultValue={ctx.me.email} autoFocus /></label>
        <p className="small muted">The test uses your name in place of the subscriber&apos;s and isn&apos;t tracked.</p>
        <p className="error">{err}</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Send test</button></div>
      </form>
    </Modal>
  );
}

function SendDialog({ ctx, c, ready, onClose, onDone }: { ctx: AppCtx; c: Campaign; ready: Readiness | null; onClose: () => void; onDone: () => void }) {
  const [when, setWhen] = useState<"now" | "later">("now");
  const [at, setAt] = useState(toLocalInput(new Date(Date.now() + 3_600_000).toISOString()));
  const [err, setErr] = useState("");
  const blocked = !!ready?.problems.length;
  return (
    <Modal title="Send campaign" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api(`/api/campaigns/${c.id}/action`, { method: "POST", json: { action: "schedule", at: when === "later" ? new Date(at).toISOString() : null } });
            ctx.say(when === "later" ? "Scheduled" : "Sending");
            onClose();
            onDone();
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        {blocked ? (
          <ul className="problems error">{ready!.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        ) : (
          <p>
            <strong>{c.subject}</strong> goes to <strong>{num(ready?.recipients ?? 0)}</strong> {ready?.recipients === 1 ? "person" : "people"} in {c.audienceName}
            {c.segmentName ? ` (${c.segmentName})` : ""}. People who unsubscribed, bounced or complained are left out.
          </p>
        )}
        <label className="check"><input type="radio" checked={when === "now"} onChange={() => setWhen("now")} /> Send now</label>
        <label className="check"><input type="radio" checked={when === "later"} onChange={() => setWhen("later")} /> Schedule for</label>
        {when === "later" && <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />}
        <p className="error">{err}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={blocked}>{when === "later" ? "Schedule" : "Send now"}</button>
        </div>
      </form>
    </Modal>
  );
}

function Report({ ctx, c, reload, back }: { ctx: AppCtx; c: Campaign; reload: () => void; back: React.ReactNode }) {
  const [filter, setFilter] = useState("");
  const [data, setData] = useState<{ links: LinkStat[]; recipients: RecipientRow[]; total: number } | null>(null);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    void api<{ links: LinkStat[]; recipients: RecipientRow[]; total: number }>(`/api/campaigns/${c.id}/report?filter=${filter}`).then(setData).catch(() => {});
  }, [c.id, filter, c.stats?.sent, c.stats?.uniqueOpens]);
  const s = c.stats!;
  const act = async (action: string, ask?: string) => {
    if (ask && !confirm(ask)) return;
    try {
      const r = await api<Campaign>(`/api/campaigns/${c.id}/action`, { method: "POST", json: { action } });
      if (action === "duplicate") ctx.go({ view: "campaigns", id: r.id });
      else reload();
    } catch (e) {
      ctx.say((e as Error).message);
    }
  };
  return (
    <div className="page">
      <div className="pagehead">
        <div className="toolbar">{back}<h1>{c.name}</h1><StatusBadge status={c.status} /></div>
        {ctx.canEdit && (
          <div className="toolbar">
            {c.status === "scheduled" && <button className="btn" onClick={() => act("unschedule")}>Back to draft</button>}
            {c.status === "sending" && <button className="btn" onClick={() => act("pause")}><Pause size={15} /> Pause</button>}
            {c.status === "paused" && <button className="btn" onClick={() => act("resume")}><Play size={15} /> Resume</button>}
            {["scheduled", "sending", "paused"].includes(c.status) && <button className="btn" onClick={() => act("cancel", "Stop this send? People not sent to yet won't get it.")}><X size={15} /> Cancel send</button>}
            <button className="btn" onClick={() => act("duplicate")}><Copy size={15} /> Duplicate</button>
            <button className="btn" onClick={() => setPreview(true)}>View email</button>
          </div>
        )}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        “{c.subject}” to {c.audienceName ?? "a deleted audience"}{c.segmentName ? ` · ${c.segmentName}` : ""}.{" "}
        {c.status === "scheduled" ? `Goes out ${formatDateTime(c.scheduledAt)}.` : `Started ${formatDateTime(c.startedAt)}${c.finishedAt ? `, finished ${formatDateTime(c.finishedAt)}` : ""}.`}
      </p>
      <div className="stats">
        <Stat k="Sent" v={num(s.sent)} sub={s.queued ? `${num(s.queued)} still queued` : `of ${num(s.recipients)} recipients`} />
        <Stat k="Opened" v={pct(s.uniqueOpens, s.sent)} sub={`${num(s.uniqueOpens)} people, ${num(s.opens)} opens`} />
        <Stat k="Clicked" v={pct(s.uniqueClicks, s.sent)} sub={`${num(s.uniqueClicks)} people, ${num(s.clicks)} clicks`} />
        <Stat k="Unsubscribed" v={num(s.unsubscribes)} sub={`${num(s.bounced)} bounced, ${num(s.failed)} failed, ${num(s.complaints)} spam reports`} />
      </div>
      <p className="small muted" style={{ margin: 0 }}>Opens are counted when the email&apos;s images load, so some mail apps over- or under-count them. Clicks are exact.</p>
      {data && data.links.length > 0 && (
        <div className="panel">
          <h3>Links</h3>
          <table className="mini">
            <thead><tr><th>Link</th><th className="num">Clicks</th><th className="num">People</th></tr></thead>
            <tbody>{data.links.map((l) => <tr key={l.url}><td className="trunc" style={{ maxWidth: 520 }}>{l.url}</td><td className="num">{num(l.clicks)}</td><td className="num">{num(l.people)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <div className="panel">
        <h3>
          Recipients
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ textTransform: "none", letterSpacing: 0 }}>
            <option value="">Everyone</option>
            <option value="opened">Opened</option>
            <option value="clicked">Clicked</option>
            <option value="unopened">Didn&apos;t open</option>
            <option value="bounced">Bounced or failed</option>
            <option value="unsubscribed">Unsubscribed</option>
          </select>
        </h3>
        <table className="mini">
          <thead><tr><th>Email</th><th>Status</th><th>Sent</th><th>Opened</th><th>Clicked</th></tr></thead>
          <tbody>
            {data?.recipients.map((r) => (
              <tr key={r.email}>
                <td>{r.email}{r.unsubscribedAt && <span className="badge red" style={{ marginLeft: 6 }}>Unsubscribed</span>}</td>
                <td title={r.error}>{label(r.status)}</td>
                <td>{formatDateTime(r.sentAt)}</td>
                <td>{r.openedAt ? formatDateTime(r.openedAt) : "—"}</td>
                <td>{r.clickedAt ? formatDateTime(r.clickedAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.total > data.recipients.length && <p className="small muted">Showing the first {data.recipients.length} of {num(data.total)}.</p>}
      </div>
      {preview && (
        <Modal title={c.subject} onClose={() => setPreview(false)} wide>
          <div className="form"><EmailPreview c={c} /></div>
        </Modal>
      )}
    </div>
  );
}

function EmailPreview({ c }: { c: Campaign }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    void api<{ html: string }>("/api/preview", { method: "POST", json: { blocks: c.blocks, preheader: c.preheader, subject: c.subject } }).then((r) => setHtml(r.html));
  }, [c]);
  return <iframe className="previewframe" title="Email" sandbox="" srcDoc={html} style={{ position: "static" }} />;
}

export function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}
