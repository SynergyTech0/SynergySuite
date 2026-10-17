"use client";
// Saved email designs: the list, and one template's editor.
import { ArrowLeft, LayoutTemplate, Plus, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Campaign, Template } from "@/lib/types";
import { api, formatDate, type AppCtx } from "./client";
import { EmailEditor, type Email } from "./EmailEditor";

export function TemplatesView({ ctx, id }: { ctx: AppCtx; id: string | null }) {
  if (id) return <TemplateEditor ctx={ctx} id={id} />;
  return <TemplateList ctx={ctx} />;
}

function TemplateList({ ctx }: { ctx: AppCtx }) {
  const [list, setList] = useState<Template[] | null>(null);
  useEffect(() => {
    void api<Template[]>("/api/templates").then(setList).catch((e) => ctx.say(e.message));
  }, [ctx]);
  const create = async () => {
    const name = prompt("Template name");
    if (!name) return;
    try {
      const t = await api<Template>("/api/templates", { method: "POST", json: { name } });
      ctx.go({ view: "templates", id: t.id });
    } catch (e) {
      ctx.say((e as Error).message);
    }
  };
  return (
    <div className="page">
      <div className="pagehead">
        <h1>Templates</h1>
        {ctx.canEdit && <button className="btn primary" onClick={create}><Plus size={16} /> New template</button>}
      </div>
      {!list ? (
        <div className="empty">Loading…</div>
      ) : !list.length ? (
        <div className="empty"><LayoutTemplate size={28} /><p>No templates yet. Save a design you reuse, like your newsletter layout.</p></div>
      ) : (
        <table className="table">
          <thead><tr><th>Name</th><th>Subject</th><th>Updated</th></tr></thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id} className="click" onClick={() => ctx.go({ view: "templates", id: t.id })}>
                <td><strong>{t.name}</strong></td>
                <td className="trunc">{t.subject || "—"}</td>
                <td>{formatDate(t.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TemplateEditor({ ctx, id }: { ctx: AppCtx; id: string }) {
  const [t, setT] = useState<Template | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState<Email | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    void api<Template>(`/api/templates/${id}`)
      .then((x) => {
        setT(x);
        setName(x.name);
        setEmail({ subject: x.subject, preheader: x.preheader, blocks: x.blocks });
      })
      .catch((e) => ctx.say(e.message));
  }, [id, ctx]);
  const save = useCallback(async () => {
    if (!email) return;
    try {
      await api(`/api/templates/${id}`, { method: "PATCH", json: { name, ...email } });
      setDirty(false);
    } catch (e) {
      ctx.say((e as Error).message);
    }
  }, [id, name, email, ctx]);
  useEffect(() => {
    if (!dirty || !ctx.canEdit) return;
    const timer = window.setTimeout(() => void save(), 1500);
    return () => window.clearTimeout(timer);
  }, [dirty, save, ctx.canEdit]);
  if (!t || !email) return <div className="empty">Loading…</div>;
  return (
    <div className="page">
      <div className="pagehead">
        <div className="toolbar">
          <button className="btn ghost" onClick={() => ctx.go({ view: "templates" })}><ArrowLeft size={16} /> Templates</button>
          <input value={name} disabled={!ctx.canEdit} onChange={(e) => { setName(e.target.value); setDirty(true); }} aria-label="Template name" style={{ fontSize: 18, fontWeight: 600, border: 0, background: "none" }} />
          <span className="small muted">{dirty ? "Unsaved changes" : "Saved"}</span>
        </div>
        {ctx.canEdit && (
          <div className="toolbar">
            <button className="btn" onClick={async () => { if (confirm("Delete this template?")) { await api(`/api/templates/${id}`, { method: "DELETE" }); ctx.go({ view: "templates" }); } }}><Trash2 size={15} /> Delete</button>
            <button
              className="btn primary"
              onClick={async () => {
                await save();
                const c = await api<Campaign>("/api/campaigns", { method: "POST", json: { name: `${name} campaign`, templateId: id } });
                ctx.go({ view: "campaigns", id: c.id });
              }}
            >
              <Send size={15} /> Use in a campaign
            </button>
          </div>
        )}
      </div>
      <EmailEditor value={email} ai={ctx.ai} readOnly={!ctx.canEdit} onChange={(v) => { setEmail(v); setDirty(true); }} />
    </div>
  );
}
