"use client";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { FEE_LABELS, STATUS_LABELS, api, money, person, shortDate, today } from "./client";
import { DecideForm, HitsTable } from "./Conflicts";
import type { Go } from "./LawApp";
import { Modal } from "./Modal";
import type { AppInfo, CheckResult, MatterSummary } from "./types";

export type Terms = {
  title: string; practiceArea: string; jurisdiction: string; court: string; caseNumber: string; description: string; feeType: string;
  rate: string; flatFee: string; contingencyPct: string; currency: string; engagementSignedOn: string; openedOn: string;
};

export const BLANK_TERMS: Terms = {
  title: "", practiceArea: "General", jurisdiction: "FED", court: "", caseNumber: "", description: "", feeType: "hourly",
  rate: "", flatFee: "", contingencyPct: "", currency: "USD", engagementSignedOn: "", openedOn: "",
};

/** The matter's details, shared by the new-matter dialog and the matter's own form. */
export function TermsFields({ t, set, info, disabled }: { t: Terms; set: (t: Terms) => void; info: AppInfo; disabled?: boolean }) {
  const f = (k: keyof Terms) => ({
    value: t[k],
    disabled,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set({ ...t, [k]: e.target.value }),
  });
  return (
    <>
      <label><span>Matter name</span><input {...f("title")} required placeholder="e.g. Doe v. Acme Holdings, or Doe estate plan" /></label>
      <div className="row2">
        <label><span>Practice area</span><select {...f("practiceArea")}>{info.practiceAreas.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label>
          <span>Jurisdiction (whose rules apply)</span>
          <select {...f("jurisdiction")}>
            <option value="FED">Federal</option>
            {info.jurisdictions.map((j) => <option key={j.code} value={j.code}>{j.name}</option>)}
          </select>
        </label>
      </div>
      <div className="row2">
        <label><span>Court (optional)</span><input {...f("court")} /></label>
        <label><span>Case number (optional)</span><input {...f("caseNumber")} /></label>
      </div>
      <div className="row3">
        <label><span>Billing</span><select {...f("feeType")}>{info.feeTypes.map((x) => <option key={x} value={x}>{FEE_LABELS[x]}</option>)}</select></label>
        {t.feeType === "hourly" && <label><span>Hourly rate</span><input inputMode="decimal" {...f("rate")} placeholder="0.00" /></label>}
        {t.feeType === "flat" && <label><span>Flat fee</span><input inputMode="decimal" {...f("flatFee")} placeholder="0.00" /></label>}
        {t.feeType === "contingency" && <label><span>Contingency %</span><input inputMode="decimal" {...f("contingencyPct")} placeholder="33.33" /></label>}
        <label><span>Engagement letter signed</span><input type="date" {...f("engagementSignedOn")} /></label>
      </div>
      <label><span>Notes</span><textarea rows={3} {...f("description")} /></label>
    </>
  );
}

export function termsPayload(t: Terms) {
  return {
    ...t,
    rate: t.rate === "" ? null : t.rate,
    flatFee: t.flatFee === "" ? null : t.flatFee,
    contingencyPct: t.contingencyPct === "" ? null : t.contingencyPct,
    engagementSignedOn: t.engagementSignedOn || null,
    openedOn: t.openedOn || undefined,
  };
}

export function MatterTable({ rows, go }: { rows: MatterSummary[]; go: Go }) {
  return (
    <div className="tablewrap">
      <table className="grid">
        <thead>
          <tr><th>Matter</th><th>Client</th><th>Area</th><th>Status</th><th>Next deadline</th><th className="num">Unbilled</th><th className="num">In trust</th><th>Lawyer</th></tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} className="click" onClick={() => go.matter(m.id)}>
              <td><span className="muted small">{m.number}</span> {m.title}</td>
              <td>{m.client_name}</td>
              <td>{m.practice_area}</td>
              <td><span className={`pill ${m.status}`}>{STATUS_LABELS[m.status]}</span></td>
              <td>{m.next_deadline ? shortDate(m.next_deadline) : <span className="muted">None</span>}</td>
              <td className="num">{Number(m.unbilled_cents) ? money(Number(m.unbilled_cents)) : ""}</td>
              <td className="num">{Number(m.trust_cents) ? money(Number(m.trust_cents)) : ""}</td>
              <td className="muted">{person(m.responsible)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MatterList({ view, info, go }: { view: "mine" | "all"; info: AppInfo; go: Go }) {
  const [rows, setRows] = useState<MatterSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams({ view });
      if (q) p.set("q", q);
      if (status) p.set("status", status);
      api<MatterSummary[]>(`/api/matters?${p}`).then(setRows).catch((e) => setError((e as Error).message));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [view, q, status]);
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>{view === "mine" ? "My matters" : "All matters"}</h1>
          <p className="sub muted">{info.admin ? "As an administrator, you see every matter." : "Matters you are responsible for or on the team of."}</p>
        </div>
      </div>
      <div className="body">
        <div className="toolbar">
          <label className="searchbox"><Search size={15} /><input placeholder="Search name, number, client or case number" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <select className="cellin" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Open and pending</option>
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        {error && <p className="error">{error}</p>}
        {!rows ? <p className="muted">Loading…</p> : !rows.length ? <div className="empty">Nothing here.</div> : <MatterTable rows={rows} go={go} />}
      </div>
    </>
  );
}

type ClientPick = { id: string; name: string; email: string };

/**
 * A new matter: who the client is and who is on the other side, a conflict check on those names,
 * then the matter's details. A check with matches needs a decision before the matter opens.
 */
export function NewMatter({ info, onClose, onSaved }: { info: AppInfo; onClose: () => void; onSaved: (id: string) => void }) {
  const [step, setStep] = useState<"people" | "check" | "details">("people");
  const [clients, setClients] = useState<ClientPick[]>([]);
  const [clientId, setClientId] = useState("");
  const [newClient, setNewClient] = useState({ name: "", kind: "person", email: "" });
  const [adverse, setAdverse] = useState("");
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [t, setT] = useState<Terms>({ ...BLANK_TERMS, openedOn: today() });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<ClientPick[]>("/api/clients").then(setClients).catch(() => {});
  }, []);
  const clientName = clientId ? clients.find((c) => c.id === clientId)?.name ?? "" : newClient.name.trim();
  const others = adverse.split("\n").map((s) => s.trim()).filter(Boolean);
  const toDetails = () => {
    setT((cur) => ({ ...cur, title: cur.title || [clientName, others[0]?.split(/\s+\(?(?:d\/?b\/?a|a\/?k\/?a)\b/i)[0]].filter(Boolean).join(" v. ") }));
    setStep("details");
  };

  return (
    <Modal title="New matter" onClose={onClose} wide>
      {step === "people" && (
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!clientName) return setError("Pick the client or enter a new one");
            setBusy(true);
            setError("");
            try {
              const r = await api<CheckResult>("/api/conflicts", { method: "POST", json: { names: [clientName, ...others] } });
              setCheck(r);
              setStep("check");
            } catch (x) {
              setError((x as Error).message);
            }
            setBusy(false);
          }}
        >
          <label>
            <span>Client</span>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">A new client</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.email ? ` (${c.email})` : ""}</option>)}
            </select>
          </label>
          {!clientId && (
            <div className="row3">
              <label><span>Name</span><input value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} /></label>
              <label><span>Kind</span><select value={newClient.kind} onChange={(e) => setNewClient({ ...newClient, kind: e.target.value })}><option value="person">Person</option><option value="organization">Organization</option></select></label>
              <label><span>Email</span><input type="email" value={newClient.email} onChange={(e) => setNewClient({ ...newClient, email: e.target.value })} /></label>
            </div>
          )}
          <label>
            <span>The other side and anyone else involved, one per line (they&apos;re checked too, and kept on the matter)</span>
            <textarea rows={4} value={adverse} onChange={(e) => setAdverse(e.target.value)} />
          </label>
          <p className="error" role="alert">{error}</p>
          <div className="actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={busy}>Check for conflicts</button>
          </div>
        </form>
      )}
      {step === "check" && check && (
        <div className="form">
          <HitsTable result={check} />
          {check.decision === "pending" ? (
            <>
              <p className="muted small">Matches are only possible conflicts: decide whether any of them is one. A declined check ends here.</p>
              <DecideForm id={check.id} onDone={(d) => (d === "declined" ? onClose() : (setCheck({ ...check, decision: d }), toDetails()))} />
            </>
          ) : (
            <div className="actions">
              <button className="btn" onClick={() => setStep("people")}>Back</button>
              <button className="btn primary" onClick={toDetails}>Continue</button>
            </div>
          )}
        </div>
      )}
      {step === "details" && check && (
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const out = await api<{ id: string }>("/api/matters", {
                method: "POST",
                json: { ...termsPayload(t), conflictCheckId: check.id, ...(clientId ? { clientId } : { client: newClient }) },
              });
              for (const name of others) await api(`/api/matters/${out.id}/parties`, { method: "POST", json: { name, role: "adverse" } }).catch(() => {});
              onSaved(out.id);
            } catch (x) {
              setError((x as Error).message);
              setBusy(false);
            }
          }}
        >
          <p className="muted small">Client: <b>{clientName}</b>. Conflict check: {check.decision}.</p>
          <TermsFields t={t} set={setT} info={info} />
          <p className="error" role="alert">{error}</p>
          <div className="actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={busy}>Open matter</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
