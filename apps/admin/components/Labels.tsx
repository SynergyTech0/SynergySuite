"use client";
// Sensitivity labels: the one list every app offers, its order (least sensitive first), the
// default for new content, and what each label protects.
import { ArrowDown, ArrowUp, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { LabelSettings, SensitivityLabel } from "@synergy/compliance";
import { api } from "./client";
import { Confirm, Modal } from "./Modal";
import { Badge, type AppCtx } from "./shared";

export function LabelChip({ label }: { label: Pick<SensitivityLabel, "name" | "color"> }) {
  return (
    <span className="labelchip" style={{ borderColor: label.color, color: label.color }}>
      <span className="labeldot" style={{ background: label.color }} />
      {label.name}
    </span>
  );
}

export function Labels({ app }: { app: AppCtx }) {
  const [d, setD] = useState<LabelSettings | null>(null);
  const [editing, setEditing] = useState<SensitivityLabel | "new" | null>(null);
  const [removing, setRemoving] = useState<SensitivityLabel | null>(null);
  const load = useCallback(() => {
    void api<LabelSettings>("/api/labels").then(setD).catch((e) => app.say(e.message));
  }, [app]);
  useEffect(load, [load]);

  const save = async (json: Record<string, unknown>, done: string) => {
    try {
      setD(await api<LabelSettings>("/api/labels", { method: "PUT", json }));
      app.say(done);
    } catch (e) {
      app.say((e as Error).message);
    }
  };
  const move = (i: number, by: number) => {
    if (!d) return;
    const ids = d.labels.map((l) => l.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    void save({ order: ids }, "Order saved");
  };

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="pagehead">
        <div>
          <h1>Sensitivity labels</h1>
          <p className="muted">People mark files, mail and documents with these. Every app offers the same list, least sensitive first.</p>
        </div>
        <button className="btn primary" onClick={() => setEditing("new")}><Plus size={16} /> New label</button>
      </div>
      <div className="notice">
        <ShieldCheck size={16} />
        <div>
          <p>Labels travel with Office files the way Microsoft Purview records them, so Word, Excel and PowerPoint show them too. A label that keeps content inside the company stops public links, guests and outside recipients in Drive and Mail. Data loss prevention rules can also act on labels.</p>
          <p>A label marks content; it doesn&apos;t encrypt it.</p>
        </div>
      </div>
      <section className="panel flush">
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Order</th><th>Label</th><th>Protection</th><th>Marking</th><th /></tr></thead>
            <tbody>
              {!d ? <tr><td colSpan={5} className="muted">Loading…</td></tr>
                : !d.labels.length ? <tr><td colSpan={5}><div className="empty"><p>No labels: apps won&apos;t offer any.</p></div></td></tr>
                : d.labels.map((l, i) => (
                  <tr key={l.id}>
                    <td className="nowrap">
                      <button className="iconbtn small" aria-label="Less sensitive" title="Less sensitive" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
                      <button className="iconbtn small" aria-label="More sensitive" title="More sensitive" disabled={i === d.labels.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
                    </td>
                    <td>
                      <div className="cellstack">
                        <span><LabelChip label={l} /> {d.defaultLabelId === l.id ? <Badge tone="blue">Default</Badge> : null}</span>
                        {l.description ? <span className="rsub">{l.description}</span> : null}
                      </div>
                    </td>
                    <td>{l.protection.blockExternal ? <Badge tone="red">Stays inside the company</Badge> : <span className="muted">None</span>}</td>
                    <td>{l.protection.marking ? <code>{l.protection.marking}</code> : <span className="muted">—</span>}</td>
                    <td className="num nowrap">
                      {d.defaultLabelId === l.id
                        ? <button className="btn small ghost" onClick={() => void save({ defaultLabelId: null }, "No default label")}>Clear default</button>
                        : <button className="btn small ghost" onClick={() => void save({ defaultLabelId: l.id }, `New content gets ${l.name}`)}>Make default</button>}{" "}
                      <button className="btn small" onClick={() => setEditing(l)}>Change</button>{" "}
                      <button className="iconbtn small" aria-label="Delete label" title="Delete label" onClick={() => setRemoving(l)}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      {d && !d.defaultLabelId ? <p className="muted small">No default label: new content has no label until someone picks one.</p> : null}
      {editing ? <LabelEditor label={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); app.say("Label saved"); load(); }} /> : null}
      {removing ? (
        <Confirm
          title="Delete this label?"
          action="Delete label"
          danger
          message={<>Content already marked <strong>{removing.name}</strong> keeps the mark, but apps stop recognizing it and its protection no longer applies.</>}
          onConfirm={async () => {
            try {
              await api(`/api/labels/${removing.id}`, { method: "DELETE" });
              app.say("Label deleted");
              load();
            } catch (e) {
              app.say((e as Error).message);
            }
          }}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </div>
  );
}

const COLORS = ["#15803d", "#2563eb", "#7c3aed", "#d97706", "#b91c1c", "#475569"];

function LabelEditor({ label, onClose, onSaved }: { label?: SensitivityLabel; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(label?.name ?? "");
  const [color, setColor] = useState(label?.color ?? COLORS[1]);
  const [description, setDescription] = useState(label?.description ?? "");
  const [blockExternal, setBlockExternal] = useState(label?.protection.blockExternal ?? false);
  const [marking, setMarking] = useState(label?.protection.marking ?? "");
  const [error, setError] = useState("");
  return (
    <Modal title={label ? "Change label" : "New label"} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const json = { name, color, description, protection: { blockExternal, marking } };
            await api(label ? `/api/labels/${label.id}` : "/api/labels", { method: label ? "PATCH" : "POST", json });
            onSaved();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <label><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus /></label>
        <label><span>Description people see when choosing</span><textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} /></label>
        <div>
          <span className="muted small">Color</span>
          <div className="seg" role="radiogroup" aria-label="Color" style={{ marginTop: 4 }}>
            {COLORS.map((c) => (
              <button type="button" key={c} role="radio" aria-checked={color === c} aria-label={c} className={color === c ? "on" : ""} onClick={() => setColor(c)}>
                <span className="labeldot" style={{ background: c }} />
              </button>
            ))}
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Other color" />
          </div>
        </div>
        <fieldset>
          <legend>Protection</legend>
          <label className="check"><input type="checkbox" checked={blockExternal} onChange={(e) => setBlockExternal(e.target.checked)} /> Keep inside the company: no public links, guests or outside recipients</label>
          <label><span>Marking shown on the content and added to outgoing mail (optional)</span><input value={marking} onChange={(e) => setMarking(e.target.value)} maxLength={80} placeholder="e.g. CONFIDENTIAL" /></label>
        </fieldset>
        <p>Preview: <LabelChip label={{ name: name || "Label", color }} /></p>
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save label</button>
        </div>
      </form>
    </Modal>
  );
}
