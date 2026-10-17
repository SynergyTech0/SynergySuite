"use client";
// Pieces of a job shared by the dispatcher's panel and the technician's phone view.
import { Camera, Check, Paperclip, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { type CatalogPart, type Staff, type WorkOrderDetail, api, person, when } from "./client";

type Reload = () => Promise<void>;

export function Checklist({ wo, reload, canDraft }: { wo: WorkOrderDetail; reload: Reload; canDraft?: boolean }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [drafting, setDrafting] = useState(false);
  const open = wo.status !== "completed" && wo.status !== "cancelled";
  const done = wo.checklist.filter((c) => c.doneAt).length;
  const run = async (f: () => Promise<unknown>) => {
    try {
      setError("");
      await f();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section>
      <h3>Steps <span className="muted">{done} of {wo.checklist.length}</span></h3>
      <ul className="checks">
        {wo.checklist.map((c) => (
          <li key={c.id} className={c.doneAt ? "done" : ""}>
            <label>
              <input type="checkbox" checked={!!c.doneAt} disabled={!open} onChange={(e) => run(() => api(`/api/work-orders/${wo.id}/checklist/${c.id}`, { method: "PATCH", json: { done: e.target.checked } }))} />
              <span className="grow">{c.title}</span>
            </label>
            {c.doneBy && <span className="small muted">{person(c.doneBy)}</span>}
            {open && <button className="iconbtn small" aria-label="Remove step" onClick={() => run(() => api(`/api/work-orders/${wo.id}/checklist/${c.id}`, { method: "DELETE" }))}><X size={14} /></button>}
          </li>
        ))}
      </ul>
      {open && (
        <form className="addrow" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/work-orders/${wo.id}/checklist`, { method: "POST", json: { title } }); setTitle(""); }); }}>
          <input className="cellin" placeholder="Add a step" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="btn small" disabled={!title.trim()}><Plus size={14} /> Add</button>
          {canDraft && (
            <button type="button" className="btn small" disabled={drafting} onClick={async () => {
              setDrafting(true);
              try {
                const r = await api<{ steps: string[] }>(`/api/work-orders/${wo.id}/checklist/draft`, { method: "POST" });
                setDraft(r.steps);
                setPicked(new Set(r.steps.map((_, i) => i)));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setDrafting(false);
              }
            }}><Sparkles size={14} /> {drafting ? "Drafting…" : "Draft steps with AI"}</button>
          )}
        </form>
      )}
      <p className="error" role="alert">{error}</p>
      {draft && (
        <Modal title="Steps drafted by AI" onClose={() => setDraft(null)}>
          <div className="form">
            <p className="small muted">Pick the steps to add to this job.</p>
            {draft.map((s, i) => (
              <label key={i} className="check">
                <input type="checkbox" checked={picked.has(i)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(i); else n.delete(i); setPicked(n); }} />
                {s}
              </label>
            ))}
            <div className="actions">
              <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn primary" disabled={!picked.size} onClick={() => run(async () => {
                for (const i of [...picked].sort((a, b) => a - b)) await api(`/api/work-orders/${wo.id}/checklist`, { method: "POST", json: { title: draft[i] } });
                setDraft(null);
              })}>Add {picked.size} steps</button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

export function Parts({ wo, reload, commerce, currency }: { wo: WorkOrderDetail; reload: Reload; commerce: boolean; currency: string }) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const open = wo.status !== "completed" && wo.status !== "cancelled";
  return (
    <section>
      <h3>Parts used</h3>
      {wo.parts.length ? (
        <ul className="lines">
          {wo.parts.map((p) => (
            <li key={p.id}>
              <span className="grow">{p.qty} {p.unit} <b>{p.name}</b> <span className="small muted">{p.sku}</span></span>
              <span className="small">{(p.unitPriceCents / 100).toLocaleString([], { style: "currency", currency })}</span>
              {commerce && <span className={`pill sync-${p.syncStatus}`} title={p.syncError}>{p.syncStatus === "synced" ? "taken from stock" : p.syncStatus === "failed" ? "not sent yet" : p.syncStatus}</span>}
              {open && p.syncStatus !== "synced" && (
                <button className="iconbtn small" aria-label="Remove part" onClick={async () => {
                  try {
                    await api(`/api/work-orders/${wo.id}/parts/${p.id}`, { method: "DELETE" });
                    await reload();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}><Trash2 size={14} /></button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">No parts yet.</p>
      )}
      <p className="error" role="alert">{error}</p>
      {open && !adding && <button className="btn small" onClick={() => setAdding(true)}><Plus size={14} /> Add a part</button>}
      {adding && <PartPicker wo={wo} commerce={commerce} onDone={async () => { setAdding(false); await reload(); }} />}
    </section>
  );
}

function PartPicker({ wo, commerce, onDone }: { wo: WorkOrderDetail; commerce: boolean; onDone: () => Promise<void> }) {
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<CatalogPart[]>([]);
  const [pick, setPick] = useState<CatalogPart | null>(null);
  const [qty, setQty] = useState("1");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!commerce || pick) return;
    const t = setTimeout(() => api<CatalogPart[]>(`/api/parts/catalog?q=${encodeURIComponent(search)}`).then(setHits, (e) => setError((e as Error).message)), 200);
    return () => clearTimeout(t);
  }, [search, commerce, pick]);
  const save = async () => {
    try {
      await api(`/api/work-orders/${wo.id}/parts`, { method: "POST", json: commerce ? { sku: pick?.sku, qty } : { name, qty, unitPrice: price } });
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="partpick">
      {commerce ? (
        pick ? (
          <div className="addrow"><b className="grow">{pick.name}</b><span className="small muted">{pick.onHand} on hand</span><button className="iconbtn small" aria-label="Pick another" onClick={() => setPick(null)}><X size={14} /></button></div>
        ) : (
          <>
            <input className="cellin" autoFocus placeholder="Search the parts catalog" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="hits">
              {hits.map((h) => (
                <button key={h.sku} type="button" onClick={() => setPick(h)} disabled={h.onHand <= 0}>
                  <span className="grow">{h.name} <span className="small muted">{h.sku}</span></span>
                  <span className="small muted">{h.onHand} on hand</span>
                </button>
              ))}
            </div>
          </>
        )
      ) : (
        <div className="addrow">
          <input className="cellin grow" autoFocus placeholder="Part" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="cellin" style={{ width: 90 }} placeholder="Price each" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
      )}
      <div className="addrow">
        <label className="small">Quantity <input className="cellin" style={{ width: 70 }} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <span className="grow" />
        <button className="btn small" onClick={() => void onDone()}>Cancel</button>
        <button className="btn small primary" disabled={commerce ? !pick : !name.trim()} onClick={() => void save()}>Use part</button>
      </div>
      <p className="error" role="alert">{error}</p>
    </div>
  );
}

export function Timeline({ wo, reload, me, staff }: { wo: WorkOrderDetail; reload: Reload; me: string; staff: Staff[] }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const upload = async (f: File | undefined) => {
    if (!f) return;
    const fd = new FormData();
    fd.set("file", f);
    try {
      setError("");
      await api(`/api/work-orders/${wo.id}/files`, { method: "POST", body: fd });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const images = wo.files.filter((f) => f.type.startsWith("image/"));
  const others = wo.files.filter((f) => !f.type.startsWith("image/"));
  return (
    <section>
      <h3>Photos and files</h3>
      {images.length > 0 && (
        <div className="thumbs">
          {images.map((f) => (
            <a key={f.id} href={`/api/work-orders/${wo.id}/files/${f.id}`} target="_blank" rel="noreferrer" title={`${f.name} · ${person(f.addedBy, staff, me)}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/work-orders/${wo.id}/files/${f.id}`} alt={f.name} />
            </a>
          ))}
        </div>
      )}
      {others.map((f) => (
        <div key={f.id} className="addrow small">
          <Paperclip size={14} /><a className="grow fname" href={`/api/work-orders/${wo.id}/files/${f.id}`}>{f.name}</a>
          <span className="muted">{person(f.addedBy, staff, me)}</span>
        </div>
      ))}
      <div className="toolbar">
        <input ref={photo} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={file} type="file" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
        <button className="btn small" onClick={() => photo.current?.click()}><Camera size={14} /> Photo</button>
        <button className="btn small" onClick={() => file.current?.click()}><Paperclip size={14} /> File</button>
      </div>
      <h3 style={{ marginTop: 16 }}>Timeline</h3>
      <form className="addrow" onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/api/work-orders/${wo.id}/notes`, { method: "POST", json: { body: note } });
          setNote("");
          await reload();
        } catch (x) {
          setError((x as Error).message);
        }
      }}>
        <input className="cellin grow" placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn small" disabled={!note.trim()}>Add</button>
      </form>
      <p className="error" role="alert">{error}</p>
      <ul className="timeline">
        {[...wo.notes].reverse().map((n) => (
          <li key={n.id} className={n.event ? "event" : ""}>
            <div className="small muted">{person(n.author, staff, me)} · {when(n.at)}</div>
            <div className="body1">{n.body}</div>
            {!n.event && n.author === me && (
              <button className="iconbtn small" aria-label="Remove note" onClick={async () => {
                await api(`/api/work-orders/${wo.id}/notes/${n.id}`, { method: "DELETE" }).catch((e) => setError((e as Error).message));
                await reload();
              }}><Trash2 size={13} /></button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A finger or mouse signature, as a PNG data URL. */
function SignaturePad({ onChange }: { onChange: (png: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const g = c.getContext("2d")!;
    g.scale(ratio, ratio);
    g.lineWidth = 2;
    g.lineCap = "round";
    g.strokeStyle = "#1f2328";
  }, []);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  return (
    <div className="sigwrap">
      <canvas
        ref={canvas}
        className="sig"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const g = e.currentTarget.getContext("2d")!;
          g.beginPath();
          g.moveTo(...pos(e));
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const g = e.currentTarget.getContext("2d")!;
          g.lineTo(...pos(e));
          g.stroke();
          inked.current = true;
        }}
        onPointerUp={(e) => {
          drawing.current = false;
          if (inked.current) onChange(e.currentTarget.toDataURL("image/png"));
        }}
      />
      <button type="button" className="btn small ghost" onClick={() => {
        const c = canvas.current!;
        c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
        inked.current = false;
        onChange(null);
      }}>Clear</button>
    </div>
  );
}

export function CompleteDialog({ wo, onClose, onDone }: { wo: WorkOrderDetail; onClose: () => void; onDone: () => Promise<void> }) {
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const left = wo.checklist.filter((c) => !c.doneAt).length;
  return (
    <Modal title={`Complete ${wo.number}`} onClose={onClose} wide>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget));
        setBusy(true);
        try {
          await api(`/api/work-orders/${wo.id}/complete`, { method: "POST", json: { ...f, signature } });
          await onDone();
          onClose();
        } catch (x) {
          setError((x as Error).message);
        } finally {
          setBusy(false);
        }
      }}>
        {left > 0 && <p className="warn">{left} step{left === 1 ? " is" : "s are"} not ticked off.</p>}
        <label><span>What was done</span><textarea name="resolution" required autoFocus defaultValue={wo.resolution} /></label>
        {/* Not a <label>: a click on the pad would press the Clear button inside it. */}
        <div className="field"><span>Customer signature</span><SignaturePad onChange={setSignature} /></div>
        <label><span>Signed by</span><input name="signedBy" defaultValue={wo.contactName} placeholder="Name of the person who signed" /></label>
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}><Check size={16} /> Complete job</button>
        </div>
      </form>
    </Modal>
  );
}
