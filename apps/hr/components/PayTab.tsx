"use client";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { type Ctx, type Employee, api, dollars, formData, money } from "./client";
import { Modal } from "./Modal";

type Deduction = {
  id: string; name: string; kind: string; amountCents: number | null; percent: number | null; matchPercent: number; matchCapPercent: number;
  annualLimitCents: number;
};

type Profile = {
  inPayroll: boolean; payType: "salary" | "hourly"; annualSalaryCents: number; hourlyRateCents: number; filingStatus: string;
  multipleJobs: boolean; dependentsCents: number; otherIncomeCents: number; deductionsCents: number; extraWithholdingCents: number;
  w4Exempt: boolean; workState: string; stateRatePercent: number; paymentMethod: string; accountLast4: string; updatedAt: string | null;
  updatedBy: string; deductions: Deduction[]; saved: boolean;
};

export const DEDUCTION_KINDS: Record<string, string> = {
  pretax_retirement: "Pre-tax retirement: 401(k), 403(b)",
  pretax_benefit: "Pre-tax benefit (Section 125): health, dental, vision, FSA, HSA",
  roth_retirement: "Roth retirement (after tax)",
  posttax: "After tax: garnishment, loan, dues",
};

const NO_TAX_STATES = ["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"];

export function PayTab({ ctx, person }: { ctx: Ctx; person: Employee }) {
  const [p, setP] = useState<Profile | null>(null);
  const [payType, setPayType] = useState<"salary" | "hourly">("salary");
  const [err, setErr] = useState("");
  const [ded, setDed] = useState<Deduction | "new" | null>(null);
  useEffect(() => {
    api<Profile>(`/api/employees/${person.id}/pay`).then((x) => {
      setP(x);
      setPayType(x.payType);
    }, (e) => setErr((e as Error).message));
  }, [person.id]);
  if (!p) return <div className="pad">{err ? <p className="error">{err}</p> : <span className="muted">Loading…</span>}</div>;

  return (
    <div className="viewbody" style={{ paddingTop: 12 }}>
      {!p.saved && <div className="banner info">{person.name} isn&apos;t set up for payroll yet. Fill this in to include them in pay runs.</div>}
      <form
        className="form"
        style={{ padding: 0 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          try {
            const saved = await api<Profile>(`/api/employees/${person.id}/pay`, { method: "PUT", json: formData(e.currentTarget) });
            setP(saved);
            ctx.toast("Pay details saved");
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <label className="check"><input type="checkbox" name="inPayroll" defaultChecked={p.saved ? p.inPayroll : true} /> Paid through payroll</label>
        <fieldset>
          <legend>Pay</legend>
          <div className="grid2">
            <label>
              <span>Paid by</span>
              <select name="payType" value={payType} onChange={(e) => setPayType(e.target.value as "salary" | "hourly")}>
                <option value="salary">Salary</option><option value="hourly">The hour</option>
              </select>
            </label>
            {payType === "salary"
              ? <label><span>Annual salary ($)</span><input name="annualSalary" inputMode="decimal" defaultValue={dollars(p.annualSalaryCents)} /></label>
              : <label><span>Hourly rate ($)</span><input name="hourlyRate" inputMode="decimal" defaultValue={dollars(p.hourlyRateCents)} /></label>}
            <label>
              <span>Paid by</span>
              <select name="paymentMethod" defaultValue={p.paymentMethod}><option value="direct_deposit">Direct deposit</option><option value="check">Paper check</option></select>
            </label>
            <label><span>Bank account, last 4 digits</span><input name="accountLast4" inputMode="numeric" maxLength={4} defaultValue={p.accountLast4} /></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Form W-4</legend>
          <label>
            <span>Step 1(c) filing status</span>
            <select name="filingStatus" defaultValue={p.filingStatus}>
              <option value="single">Single or married filing separately</option>
              <option value="married">Married filing jointly</option>
              <option value="head">Head of household</option>
            </select>
          </label>
          <label className="check"><input type="checkbox" name="multipleJobs" defaultChecked={p.multipleJobs} /> Step 2(c) box checked: two jobs or spouse works</label>
          <div className="grid2">
            <label><span>Step 3 dependents ($ a year)</span><input name="dependents" inputMode="decimal" defaultValue={dollars(p.dependentsCents)} /></label>
            <label><span>Step 4(a) other income ($ a year)</span><input name="otherIncome" inputMode="decimal" defaultValue={dollars(p.otherIncomeCents)} /></label>
            <label><span>Step 4(b) deductions ($ a year)</span><input name="deductions" inputMode="decimal" defaultValue={dollars(p.deductionsCents)} /></label>
            <label><span>Step 4(c) extra each paycheck ($)</span><input name="extraWithholding" inputMode="decimal" defaultValue={dollars(p.extraWithholdingCents)} /></label>
          </div>
          <label className="check"><input type="checkbox" name="w4Exempt" defaultChecked={p.w4Exempt} /> Claims exemption from withholding</label>
        </fieldset>
        <fieldset>
          <legend>State</legend>
          <div className="grid2">
            <label><span>Work state</span><input name="workState" maxLength={2} defaultValue={p.workState} placeholder="CA" style={{ textTransform: "uppercase" }} /></label>
            <label><span>State income tax (% of taxable pay)</span><input name="stateRatePercent" inputMode="decimal" defaultValue={p.stateRatePercent || ""} /></label>
          </div>
          <p className="small muted">State withholding is a flat estimate for now. {NO_TAX_STATES.join(", ")} have no state tax on wages.</p>
        </fieldset>
        <p className="error" role="alert">{err}</p>
        <div className="actions">
          {p.updatedAt && <span className="small muted grow">Changed {new Date(p.updatedAt).toLocaleDateString()} by {p.updatedBy}</span>}
          <button className="btn primary">Save pay details</button>
        </div>
      </form>

      <section className="section">
        <div className="row"><h3 style={{ margin: 0 }}>Deductions and benefits</h3><button className="btn small right" onClick={() => setDed("new")}><Plus size={14} /> Add</button></div>
        {p.deductions.length === 0 ? <p className="empty">None.</p> : (
          <table className="list">
            <tbody>
              {p.deductions.map((d) => (
                <tr key={d.id} className="click" onClick={() => setDed(d)}>
                  <td><b>{d.name}</b><div className="small muted">{DEDUCTION_KINDS[d.kind]}</div></td>
                  <td className="num">{d.percent !== null ? `${d.percent}%` : money(d.amountCents)}{d.matchPercent > 0 && <div className="small muted">match {d.matchPercent}%{d.matchCapPercent ? ` up to ${d.matchCapPercent}% of pay` : ""}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {ded && <DeductionDialog personId={person.id} d={ded === "new" ? null : ded} onClose={() => setDed(null)} onSaved={(x) => { setP(x); setDed(null); }} />}
    </div>
  );
}

function DeductionDialog({ personId, d, onClose, onSaved }: { personId: string; d: Deduction | null; onClose: () => void; onSaved: (p: Profile) => void }) {
  const [byPercent, setByPercent] = useState(d ? d.percent !== null : false);
  const [err, setErr] = useState("");
  return (
    <Modal title={d ? d.name : "Add a deduction"} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const b = formData(e.currentTarget);
          if (byPercent) delete b.amount;
          else delete b.percent;
          try {
            onSaved(d
              ? await api<Profile>(`/api/deductions/${d.id}`, { method: "PATCH", json: b })
              : await api<Profile>(`/api/employees/${personId}/deductions`, { method: "POST", json: b }));
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <label><span>Name</span><input name="name" defaultValue={d?.name} placeholder="401(k), Medical plan…" required autoFocus /></label>
        <label>
          <span>Kind</span>
          <select name="kind" defaultValue={d?.kind ?? "pretax_retirement"}>
            {Object.entries(DEDUCTION_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <div className="grid2">
          <label>
            <span>Each paycheck</span>
            <select value={byPercent ? "p" : "a"} onChange={(e) => setByPercent(e.target.value === "p")}>
              <option value="a">A fixed amount</option><option value="p">A percent of gross pay</option>
            </select>
          </label>
          {byPercent
            ? <label><span>Percent</span><input name="percent" inputMode="decimal" defaultValue={d?.percent ?? ""} /></label>
            : <label><span>Amount ($)</span><input name="amount" inputMode="decimal" defaultValue={dollars(d?.amountCents)} /></label>}
          <label><span>Employer match (% of what they put in)</span><input name="matchPercent" inputMode="decimal" defaultValue={d?.matchPercent || ""} /></label>
          <label><span>Match up to (% of gross pay)</span><input name="matchCapPercent" inputMode="decimal" defaultValue={d?.matchCapPercent || ""} /></label>
          <label><span>Yearly limit ($)</span><input name="annualLimit" inputMode="decimal" defaultValue={dollars(d?.annualLimitCents)} /></label>
        </div>
        <p className="error" role="alert">{err}</p>
        <div className="actions">
          {d && (
            <button type="button" className="btn ghost" style={{ marginRight: "auto", color: "var(--danger)" }}
              onClick={async () => onSaved(await api<Profile>(`/api/deductions/${d.id}`, { method: "DELETE" }))}>
              <Trash2 size={15} /> Stop this deduction
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}
