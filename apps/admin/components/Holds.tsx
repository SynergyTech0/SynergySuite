"use client";
// Holds: every legal hold across the matters you can see, and who is on hold.
import { Gavel, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { HoldRecord, Matter } from "@/lib/types";
import { api, plural } from "./client";
import { HoldEditor, HoldTable, ReleaseHold } from "./Matters";
import { Modal } from "./Modal";
import type { AppCtx } from "./shared";

export function Holds({ app }: { app: AppCtx }) {
  const [holds, setHolds] = useState<HoldRecord[] | null>(null);
  const [status, setStatus] = useState<"active" | "released" | "">("active");
  const [who, setWho] = useState("");
  const [edit, setEdit] = useState<HoldRecord | null>(null);
  const [releasing, setReleasing] = useState<HoldRecord | null>(null);
  const [picking, setPicking] = useState(false);
  const [placing, setPlacing] = useState<Matter | null>(null);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (who.trim()) p.set("custodian", who.trim().toLowerCase());
    void api<HoldRecord[]>(`/api/holds?${p}`).then(setHolds).catch((e) => app.say(e.message));
  }, [app, status, who]);
  useEffect(() => {
    const t = setTimeout(load, who ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, who]);

  const people = new Set((holds ?? []).filter((h) => h.active && h.matterStatus === "open").flatMap((h) => h.custodians));

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Holds</h1>
          <p className="muted">{holds ? `${plural(people.size, "person", "people")} on hold in what's shown.` : " "} Released holds stay on record.</p>
        </div>
        <button className="btn primary" onClick={() => setPicking(true)}><Gavel size={16} /> Place a hold</button>
      </div>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Show">
          {([["active", "Active"], ["released", "Released"], ["", "All"]] as const).map(([v, t]) => (
            <button key={t} className={status === v ? "on" : ""} aria-pressed={status === v} onClick={() => setStatus(v)}>{t}</button>
          ))}
        </div>
        <label className="search"><Search size={16} /><input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Custodian email" aria-label="Custodian email" /></label>
      </div>
      <section className="panel flush">
        {!holds ? <p className="muted pad">Loading…</p> : <HoldTable app={app} holds={holds} showMatter onEdit={setEdit} onRelease={setReleasing} />}
      </section>
      {picking ? <PickMatter app={app} onClose={() => setPicking(false)} onPick={(m) => { setPicking(false); setPlacing(m); }} /> : null}
      {placing ? <HoldEditor app={app} matter={placing} onClose={() => setPlacing(null)} onSaved={() => { setPlacing(null); app.say("Hold placed"); load(); }} /> : null}
      {edit ? <HoldEditor app={app} matter={{ id: edit.matterId, name: edit.matterName }} hold={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); app.say("Hold updated"); load(); }} /> : null}
      {releasing ? <ReleaseHold app={app} hold={releasing} onClose={() => setReleasing(null)} onDone={load} /> : null}
    </div>
  );
}

/** Holds belong to a matter; pick one (open matters only). */
export function PickMatter({ app, title = "Which matter is this hold for?", action = "Next", onClose, onPick }: {
  app: AppCtx; title?: string; action?: string; onClose: () => void; onPick: (m: Matter) => void;
}) {
  const [list, setList] = useState<Matter[] | null>(null);
  const [sel, setSel] = useState("");
  useEffect(() => {
    void api<Matter[]>("/api/matters?status=open").then((l) => { setList(l); setSel(l[0]?.id ?? ""); }).catch((e) => app.say(e.message));
  }, [app]);
  return (
    <Modal title={title} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); const m = list?.find((x) => x.id === sel); if (m) onPick(m); }}>
        {!list ? <p className="muted">Loading…</p> : !list.length ? (
          <p>There are no open matters. <a className="link" href="#/matters" onClick={onClose}>Open a matter</a> first.</p>
        ) : (
          <label>
            <span>Matter</span>
            <select value={sel} onChange={(e) => setSel(e.target.value)} autoFocus>
              {list.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!sel}>{action}</button>
        </div>
      </form>
    </Modal>
  );
}
