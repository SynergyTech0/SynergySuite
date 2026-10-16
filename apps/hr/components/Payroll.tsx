"use client";
import { ArrowLeft, Building2, Download, Plus, Settings2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { type Ctx, addDays, api, dayLabel, dollars, formData, money, rangeLabel, today } from "./client";
import { Modal } from "./Modal";

type Totals = { grossCents: number; deductionsCents: number; taxesCents: number; netCents: number; employerTaxesCents: number; employerBenefitsCents: number; employees: number; offCycle?: boolean };
type Run = {
  id: string; number: number; periodStart: string; periodEnd: string; payDate: string; frequency: string; status: "draft" | "approved" | "paid" | "void";
  totals: Totals; note: string; createdBy: string; approvedBy: string | null; paidAt: string | null; booksStatus: "none" | "posted" | "failed" | "off";
  booksJournal: string | null; booksError: string | null;
};
type Line = { code: string; label: string; amountCents: number; hours?: number; rateCents?: number };
type Hours = { regular: number; overtime: number; pto: number; holiday: number; sick: number; bonusCents: number; salaryFraction?: number };
type Check = {
  id: string; employeeId: string; employeeName: string; employeeEmail: string; hours: Hours; profile: { payType: string };
  result: { earnings: Line[]; deductions: Line[]; taxes: Line[]; employerTaxes: Line[]; grossCents: number; deductionsCents: number; taxesCents: number; netCents: number; warnings: string[]; taxYear: number };
};
type Settings = {
  companyName: string; frequency: string; overtimeMultiplier: number; sutaRatePercent: number; sutaWageBaseCents: number;
  accounts: Record<string, string>; booksOrg: string; booksConnected: boolean;
};
type Quarter = { quarter: number; runs: number; grossCents: number; federalWagesCents: number; ficaWagesCents: number; federalCents: number; socialSecurityCents: number; medicareCents: number; stateCents: number; futaCents: number; sutaCents: number; netCents: number };

const FREQ: Record<string, { label: string; days: number }> = {
  weekly: { label: "Every week", days: 7 }, biweekly: { label: "Every two weeks", days: 14 }, semimonthly: { label: "Twice a month", days: 15 }, monthly: { label: "Every month", days: 30 },
};
const ACCOUNT_LABELS: Record<string, string> = {
  wagesExpense: "Gross wages (expense)", employerTaxExpense: "Employer payroll taxes (expense)", benefitsExpense: "Employer contributions (expense)",
  taxesPayable: "Payroll taxes owed (liability)", benefitsPayable: "Deductions and benefits owed (liability)", netPayPayable: "Net pay owed (liability)",
};

export function Payroll({ ctx }: { ctx: Ctx }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingSettings, setEditingSettings] = useState(false);
  const [editingEmployer, setEditingEmployer] = useState(false);
  const [summaryYear, setSummaryYear] = useState(new Date().getFullYear());
  const [summary, setSummary] = useState<Quarter[]>([]);

  const load = async () => {
    const [r, s] = await Promise.all([api<Run[]>("/api/payroll/runs"), api<Settings>("/api/payroll/settings")]);
    setRuns(r);
    setSettings(s);
  };
  useEffect(() => {
    load().catch((e) => ctx.toast((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    api<Quarter[]>(`/api/payroll/summary?year=${summaryYear}`).then(setSummary, () => setSummary([]));
  }, [summaryYear, runs]);

  if (open) return <RunView ctx={ctx} id={open} settings={settings} onBack={async () => { setOpen(null); await load(); }} />;
  if (!runs || !settings) return <main className="view pad muted">Loading…</main>;

  return (
    <main className="view">
      <div className="viewhead">
        <h1>Payroll</h1>
        <div className="right row">
          <button className="btn" onClick={() => setEditingEmployer(true)}><Building2 size={16} /> Company and bank</button>
          <button className="btn" onClick={() => setEditingSettings(true)}><Settings2 size={16} /> Settings</button>
          <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> New pay run</button>
        </div>
      </div>
      <div className="viewbody">
        <div className="banner">
          Payroll works out US federal withholding, Social Security, Medicare and FUTA from the published 2026 figures, and state withholding from each state's
          published tables. It does not file returns, deposit taxes or move money. Check the results against IRS Publication 15-T before you pay people.
        </div>
        {!settings.booksConnected && (
          <div className="banner info">Books isn&apos;t connected, so paid runs won&apos;t reach the ledger. Set BOOKS_SVC_TOKEN for HR and Books to the same value.</div>
        )}
        <section className="section">
          <h3>Pay runs</h3>
          {runs.length === 0 ? <p className="empty">No pay runs yet. Set up pay details on each person&apos;s Pay tab, then start a run.</p> : (
            <table className="list">
              <thead><tr><th>Run</th><th>Pay date</th><th className="hide-sm">Period</th><th className="num">People</th><th className="num">Gross</th><th className="num hide-sm">Net</th><th>Status</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="click" onClick={() => setOpen(r.id)}>
                    <td>{r.number}{r.totals.offCycle && <span className="small muted"> off-cycle</span>}</td>
                    <td>{dayLabel(r.payDate)}</td>
                    <td className="hide-sm">{rangeLabel(r.periodStart, r.periodEnd)}</td>
                    <td className="num">{r.totals.employees}</td>
                    <td className="num">{money(r.totals.grossCents)}</td>
                    <td className="num hide-sm">{money(r.totals.netCents)}</td>
                    <td>
                      <span className={`badge ${r.status}`}>{r.status}</span>{" "}
                      {r.status === "paid" && r.booksStatus === "failed" && <span className="badge failed">not in Books</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="section">
          <div className="row">
            <h3 style={{ margin: 0 }}>Tax summary by quarter</h3>
            <select className="btn small right" value={summaryYear} onChange={(e) => setSummaryYear(Number(e.target.value))} aria-label="Year">
              {[0, 1, 2].map((d) => <option key={d}>{new Date().getFullYear() - d}</option>)}
            </select>
          </div>
          <p className="small muted">Paid runs only. Social Security and Medicare include the employer share, as on Form 941.</p>
          <div style={{ overflowX: "auto" }}>
            <table className="list">
              <thead><tr><th>Quarter</th><th className="num">Gross wages</th><th className="num">Federal income tax</th><th className="num">Social Security</th><th className="num">Medicare</th><th className="num">State</th><th className="num">FUTA</th><th className="num">SUTA</th></tr></thead>
              <tbody>
                {summary.map((q) => (
                  <tr key={q.quarter}>
                    <td>Q{q.quarter}</td><td className="num">{money(q.grossCents)}</td><td className="num">{money(q.federalCents)}</td>
                    <td className="num">{money(q.socialSecurityCents)}</td><td className="num">{money(q.medicareCents)}</td><td className="num">{money(q.stateCents)}</td>
                    <td className="num">{money(q.futaCents)}</td><td className="num">{money(q.sutaCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {creating && <NewRunDialog settings={settings} last={runs.find((r) => r.status !== "void" && !r.totals.offCycle)} onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); setOpen(id); }} />}
      {editingEmployer && <EmployerDialog onClose={() => setEditingEmployer(false)} onDone={() => { setEditingEmployer(false); ctx.toast("Company and bank details saved"); }} />}
      {editingSettings && <SettingsDialog s={settings} onClose={() => setEditingSettings(false)} onDone={(s) => { setSettings(s); setEditingSettings(false); ctx.toast("Payroll settings saved"); }} />}
    </main>
  );
}

function NewRunDialog({ settings, last, onClose, onDone }: { settings: Settings; last?: Run; onClose: () => void; onDone: (id: string) => void }) {
  const f = FREQ[settings.frequency] ?? FREQ.biweekly;
  const start = last ? addDays(last.periodEnd, 1) : addDays(today(), -f.days + 1);
  const end = settings.frequency === "monthly" ? addDays(start, 29) : settings.frequency === "semimonthly" ? addDays(start, 14) : addDays(start, f.days - 1);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="New pay run" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          onDone((await api<{ id: string }>("/api/payroll/runs", { method: "POST", json: formData(e.currentTarget) })).id);
        } catch (x) {
          setErr((x as Error).message);
          setBusy(false);
        }
      }}>
        <div className="grid2">
          <label><span>Period starts</span><input type="date" name="periodStart" defaultValue={start} required /></label>
          <label><span>Period ends</span><input type="date" name="periodEnd" defaultValue={end} required /></label>
          <label><span>Pay date</span><input type="date" name="payDate" defaultValue={addDays(end, 5)} required /></label>
        </div>
        <label className="check"><input type="checkbox" name="offCycle" /> Off-cycle run (bonuses or corrections; nobody&apos;s usual pay)</label>
        <label><span>Note (optional)</span><input name="note" /></label>
        <p className="small muted">Everyone set up for payroll is added with their usual hours, approved time off and company holidays. You can change hours before approving.</p>
        <p className="error" role="alert">{err}</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Create</button></div>
      </form>
    </Modal>
  );
}

function SettingsDialog({ s, onClose, onDone }: { s: Settings; onClose: () => void; onDone: (s: Settings) => void }) {
  const [err, setErr] = useState("");
  return (
    <Modal title="Payroll settings" onClose={onClose} wide>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const b = formData(e.currentTarget);
        const accounts: Record<string, unknown> = {};
        for (const k of Object.keys(ACCOUNT_LABELS)) {
          accounts[k] = b[`acct_${k}`];
          delete b[`acct_${k}`];
        }
        try {
          onDone(await api<Settings>("/api/payroll/settings", { method: "PUT", json: { ...b, accounts } }));
        } catch (x) {
          setErr((x as Error).message);
        }
      }}>
        <div className="grid2">
          <label><span>Company name on pay stubs</span><input name="companyName" defaultValue={s.companyName} /></label>
          <label><span>Pay schedule</span>
            <select name="frequency" defaultValue={s.frequency}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          </label>
          <label><span>Overtime pays (× the hourly rate)</span><input name="overtimeMultiplier" inputMode="decimal" defaultValue={s.overtimeMultiplier} /></label>
          <span />
          <label><span>State unemployment rate (%)</span><input name="sutaRatePercent" inputMode="decimal" defaultValue={s.sutaRatePercent || ""} /></label>
          <label><span>State unemployment wage base ($)</span><input name="sutaWageBase" inputMode="decimal" defaultValue={dollars(s.sutaWageBaseCents)} /></label>
        </div>
        <fieldset>
          <legend>Books accounts for each paid run</legend>
          <div className="grid2">
            {Object.entries(ACCOUNT_LABELS).map(([k, label]) => (
              <label key={k}><span>{label}</span><input name={`acct_${k}`} defaultValue={s.accounts[k]} /></label>
            ))}
            <label><span>Books organization ID (only if Books has several)</span><input name="booksOrg" defaultValue={s.booksOrg} /></label>
          </div>
          <p className="small muted">Books makes any of these accounts that don&apos;t exist yet. The defaults match Books&apos; standard chart of accounts.</p>
        </fieldset>
        <p className="error" role="alert">{err}</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
      </form>
    </Modal>
  );
}

function RunView({ ctx, id, settings, onBack }: { ctx: Ctx; id: string; settings: Settings | null; onBack: () => void }) {
  const [data, setData] = useState<{ run: Run; paychecks: Check[] } | null>(null);
  const [editing, setEditing] = useState<Check | null>(null);
  const [deposit, setDeposit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = () => api<{ run: Run; paychecks: Check[] }>(`/api/payroll/runs/${id}`).then(setData, (e) => setErr((e as Error).message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const act = async (action: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setErr("");
    try {
      await api(`/api/payroll/runs/${id}/${action}`, { method: "POST" });
      await load();
    } catch (x) {
      setErr((x as Error).message);
    }
    setBusy(false);
  };

  if (!data) return <main className="view pad">{err ? <p className="error">{err}</p> : <span className="muted">Loading…</span>}</main>;
  const { run, paychecks } = data;
  const draft = run.status === "draft";
  const warnings = paychecks.flatMap((c) => c.result.warnings.map((w) => `${c.employeeName}: ${w}`));

  return (
    <main className="view">
      <div className="viewhead">
        <button className="iconbtn" aria-label="Back to pay runs" onClick={onBack}><ArrowLeft size={18} /></button>
        <h1>Pay run {run.number}</h1>
        <span className={`badge ${run.status}`}>{run.status}</span>
        <div className="right row">
          {draft && <button className="btn" disabled={busy} onClick={() => act("recalculate")}>Recalculate</button>}
          {draft && <button className="btn" disabled={busy} onClick={() => act("void", "Void this pay run? It can't be undone.")}>Void</button>}
          {draft && <button className="btn primary" disabled={busy} onClick={() => act("approve")}>Approve</button>}
          {(run.status === "approved" || run.status === "paid") && <button className="btn" onClick={() => setDeposit(true)}><Download size={16} /> Deposit file</button>}
          {run.status === "approved" && <button className="btn" disabled={busy} onClick={() => act("reopen")}>Back to draft</button>}
          {run.status === "approved" && (
            <button className="btn primary" disabled={busy} onClick={() => act("pay", `Mark pay run ${run.number} as paid${settings?.booksConnected ? " and post it to Books" : ""}? Employees will see their pay stubs.`)}>
              Mark paid
            </button>
          )}
          {run.status === "paid" && run.booksStatus !== "posted" && settings?.booksConnected && <button className="btn" disabled={busy} onClick={() => act("post")}>Post to Books</button>}
        </div>
      </div>
      <div className="viewbody">
        <p className="muted" style={{ margin: 0 }}>
          {rangeLabel(run.periodStart, run.periodEnd)}, paid {dayLabel(run.payDate)}{run.totals.offCycle ? ", off-cycle" : ""}{run.note ? `. ${run.note}` : ""}
        </p>
        {err && <p className="error" role="alert">{err}</p>}
        {run.status === "paid" && (
          <p className="small" style={{ margin: 0 }}>
            {run.booksStatus === "posted" && <span className="ok">Posted to Books as {run.booksJournal}.</span>}
            {run.booksStatus === "failed" && <span className="error">Books didn&apos;t take the journal: {run.booksError}</span>}
            {run.booksStatus === "off" && <span className="muted">Books isn&apos;t connected, so this run wasn&apos;t posted.</span>}
          </p>
        )}
        {warnings.length > 0 && <div className="banner">{warnings.map((w) => <div key={w}>{w}</div>)}</div>}
        <div className="cards">
          <div className="card"><div className="k">Gross pay</div><div className="v">{money(run.totals.grossCents)}</div><div className="s">{run.totals.employees} people</div></div>
          <div className="card"><div className="k">Take-home pay</div><div className="v">{money(run.totals.netCents)}</div></div>
          <div className="card"><div className="k">Taxes withheld</div><div className="v">{money(run.totals.taxesCents)}</div><div className="s">{money(run.totals.deductionsCents)} other deductions</div></div>
          <div className="card"><div className="k">Employer cost</div><div className="v">{money(run.totals.grossCents + run.totals.employerTaxesCents + run.totals.employerBenefitsCents)}</div><div className="s">{money(run.totals.employerTaxesCents)} taxes, {money(run.totals.employerBenefitsCents)} contributions</div></div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="list">
            <thead><tr><th>Person</th><th className="num">Hours</th><th className="num">Gross</th><th className="num">Taxes</th><th className="num">Deductions</th><th className="num">Net</th><th /></tr></thead>
            <tbody>
              {paychecks.map((c) => {
                const h = c.hours;
                const hours = h.regular + h.overtime + (c.profile.payType === "hourly" ? h.pto + h.holiday + h.sick : 0);
                return (
                  <tr key={c.id} className={draft ? "click" : ""} onClick={() => draft && setEditing(c)}>
                    <td><b>{c.employeeName}</b><div className="small muted">{c.profile.payType === "salary" ? "Salary" : "Hourly"}{h.bonusCents ? `, bonus ${money(h.bonusCents)}` : ""}</div></td>
                    <td className="num">{hours}</td>
                    <td className="num">{money(c.result.grossCents)}</td>
                    <td className="num">{money(c.result.taxesCents)}</td>
                    <td className="num">{money(c.result.deductionsCents)}</td>
                    <td className="num"><b className={c.result.netCents < 0 ? "error" : ""}>{money(c.result.netCents)}</b></td>
                    <td className="num"><a href={`/stubs/${c.id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Stub</a></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td>Total</td><td /><td className="num">{money(run.totals.grossCents)}</td><td className="num">{money(run.totals.taxesCents)}</td><td className="num">{money(run.totals.deductionsCents)}</td><td className="num">{money(run.totals.netCents)}</td><td /></tr></tfoot>
          </table>
        </div>
        {draft && <p className="small muted">Click someone to change their hours or add a bonus. Pay details changed since this run started? Recalculate.</p>}
      </div>
      {deposit && <DepositDialog runId={run.id} onClose={() => setDeposit(false)} />}
      {editing && <HoursDialog c={editing} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await load(); }} onRemoved={async () => { setEditing(null); ctx.toast("Taken out of this run"); await load(); }} />}
    </main>
  );
}

function HoursDialog({ c, onClose, onDone, onRemoved }: { c: Check; onClose: () => void; onDone: () => void; onRemoved: () => void }) {
  const [err, setErr] = useState("");
  const h = c.hours;
  const salary = c.profile.payType === "salary";
  return (
    <Modal title={c.employeeName} onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/api/payroll/paychecks/${c.id}`, { method: "PATCH", json: formData(e.currentTarget) });
          onDone();
        } catch (x) {
          setErr((x as Error).message);
        }
      }}>
        <div className="grid2">
          {!salary && <label><span>Regular hours</span><input name="regular" inputMode="decimal" defaultValue={h.regular} /></label>}
          <label><span>Overtime hours</span><input name="overtime" inputMode="decimal" defaultValue={h.overtime} /></label>
          <label><span>Time off hours</span><input name="pto" inputMode="decimal" defaultValue={h.pto} /></label>
          <label><span>Sick hours</span><input name="sick" inputMode="decimal" defaultValue={h.sick} /></label>
          <label><span>Holiday hours</span><input name="holiday" inputMode="decimal" defaultValue={h.holiday} /></label>
          <label><span>Bonus ($)</span><input name="bonus" inputMode="decimal" defaultValue={dollars(h.bonusCents)} /></label>
          {salary && <label><span>Share of the period&apos;s salary (0 to 1)</span><input name="salaryFraction" inputMode="decimal" defaultValue={h.salaryFraction ?? 1} /></label>}
        </div>
        {salary && <p className="small muted">Salaried time off is part of the salary; the hours are kept for the record.</p>}
        <p className="error" role="alert">{err}</p>
        <div className="actions">
          <button type="button" className="btn ghost" style={{ marginRight: "auto", color: "var(--danger)" }} onClick={async () => { await api(`/api/payroll/paychecks/${c.id}`, { method: "DELETE" }); onRemoved(); }}>
            <Trash2 size={15} /> Take out of this run
          </button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}

type Ach = {
  odfiRouting: string; odfiName: string; originId: string; companyId: string; companyName: string; balanced: boolean; offsetRouting: string;
  offsetType: "checking" | "savings"; offsetLast4: string;
};
type Employer = {
  ein: string; legalName: string; address1: string; address2: string; city: string; state: string; zip: string; phone: string;
  stateIds: Record<string, string>; contactName: string; contactEmail: string; contactPhone: string; bsoUserId: string; ach: Ach;
};

/** The company as tax forms and the bank know it. */
function EmployerDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [e, setE] = useState<Employer | null>(null);
  const [balanced, setBalanced] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<Employer>("/api/payroll/employer").then((x) => { setE(x); setBalanced(x.ach.balanced); }, (x) => setErr((x as Error).message));
  }, []);
  return (
    <Modal title="Company and bank" onClose={onClose} wide>
      {!e ? <p className={err ? "error" : "muted"}>{err || "Loading…"}</p> : (
        <form className="form" autoComplete="off" onSubmit={async (ev) => {
          ev.preventDefault();
          const b = formData(ev.currentTarget);
          const ach: Record<string, unknown> = {};
          const stateIds: Record<string, string> = {};
          for (const [k, v] of Object.entries(b)) {
            if (k.startsWith("ach_")) { ach[k.slice(4)] = v; delete b[k]; }
          }
          for (const line of String(b.stateIdsText ?? "").split(/\n/)) {
            const m = line.trim().match(/^([A-Za-z]{2})\s*[:=,\s]\s*(.+)$/);
            if (m) stateIds[m[1].toUpperCase()] = m[2].trim();
          }
          delete b.stateIdsText;
          if (!ach.offsetAccount) delete ach.offsetAccount;
          try {
            await api("/api/payroll/employer", { method: "PUT", json: { ...b, stateIds, ach } });
            onDone();
          } catch (x) {
            setErr((x as Error).message);
          }
        }}>
          <fieldset>
            <legend>Employer, as on W-2s and tax returns</legend>
            <div className="grid2">
              <label><span>Legal name</span><input name="legalName" defaultValue={e.legalName} /></label>
              <label><span>EIN</span><input name="ein" defaultValue={e.ein} placeholder="12-3456789" /></label>
              <label><span>Street address</span><input name="address1" defaultValue={e.address1} /></label>
              <label><span>Suite</span><input name="address2" defaultValue={e.address2} /></label>
            </div>
            <div className="grid3">
              <label><span>City</span><input name="city" defaultValue={e.city} /></label>
              <label><span>State</span><input name="state" maxLength={2} defaultValue={e.state} style={{ textTransform: "uppercase" }} /></label>
              <label><span>ZIP code</span><input name="zip" defaultValue={e.zip} /></label>
            </div>
            <label><span>Phone</span><input name="phone" defaultValue={e.phone} /></label>
            <label>
              <span>State withholding account numbers, one per line (CA: 123-4567-8)</span>
              <textarea name="stateIdsText" rows={3} defaultValue={Object.entries(e.stateIds).map(([k, v]) => `${k}: ${v}`).join("\n")} />
            </label>
          </fieldset>
          <fieldset>
            <legend>W-2 filing with the Social Security Administration</legend>
            <div className="grid2">
              <label><span>Contact name</span><input name="contactName" defaultValue={e.contactName} /></label>
              <label><span>Contact email</span><input name="contactEmail" defaultValue={e.contactEmail} /></label>
              <label><span>Contact phone</span><input name="contactPhone" defaultValue={e.contactPhone} /></label>
              <label><span>BSO user ID</span><input name="bsoUserId" maxLength={8} defaultValue={e.bsoUserId} /></label>
            </div>
          </fieldset>
          <fieldset>
            <legend>Direct deposit, from your bank&apos;s ACH setup</legend>
            <div className="grid2">
              <label><span>Your bank&apos;s routing number</span><input name="ach_odfiRouting" inputMode="numeric" maxLength={9} defaultValue={e.ach.odfiRouting} /></label>
              <label><span>Your bank&apos;s name</span><input name="ach_odfiName" maxLength={23} defaultValue={e.ach.odfiName} /></label>
              <label><span>Immediate origin (often 1 and your EIN)</span><input name="ach_originId" maxLength={10} defaultValue={e.ach.originId} /></label>
              <label><span>Company ID</span><input name="ach_companyId" maxLength={10} defaultValue={e.ach.companyId} /></label>
              <label><span>Name on employees&apos; bank statements</span><input name="ach_companyName" maxLength={16} defaultValue={e.ach.companyName} /></label>
            </div>
            <label className="check">
              <input type="checkbox" name="ach_balanced" checked={balanced} onChange={(x) => setBalanced(x.target.checked)} /> My bank wants balanced files (one debit from the company account)
            </label>
            <div className="grid3" hidden={!balanced}>
              <label><span>Company routing number</span><input name="ach_offsetRouting" inputMode="numeric" maxLength={9} defaultValue={e.ach.offsetRouting} /></label>
              <label><span>Company account number</span><input name="ach_offsetAccount" placeholder={e.ach.offsetLast4 ? `On file, ending ${e.ach.offsetLast4}` : ""} /></label>
              <label><span>Account type</span><select name="ach_offsetType" defaultValue={e.ach.offsetType}><option value="checking">Checking</option><option value="savings">Savings</option></select></label>
            </div>
          </fieldset>
          <p className="error" role="alert">{err}</p>
          <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
        </form>
      )}
    </Modal>
  );
}

type DepositPreview = {
  runNumber: number; payDate: string; checks: number; totalCents: number; ready: boolean;
  lines: { employeeId: string; name: string; amountCents: number; accountLast4: string; problem: string }[];
};

/** Who's in the run's NACHA file, what's missing, and the download. */
function DepositDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [d, setD] = useState<DepositPreview | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<DepositPreview>(`/api/payroll/runs/${runId}/deposit`).then(setD, (x) => setErr((x as Error).message));
  }, [runId]);
  const download = async () => {
    setErr("");
    const res = await fetch(`/api/payroll/runs/${runId}/deposit?download=1`);
    if (!res.ok) {
      setErr(((await res.json().catch(() => ({}))) as { error?: string }).error || `Request failed (${res.status})`);
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "payroll.ach";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Modal title="Direct deposit file" onClose={onClose} wide>
      {!d ? <p className={err ? "error" : "muted"}>{err || "Loading…"}</p> : (
        <div className="form">
          <p className="small muted" style={{ margin: 0 }}>
            A NACHA file for pay run {d.runNumber}, settling {dayLabel(d.payDate)}. Upload it to your bank&apos;s ACH or payroll page
            {d.checks ? `. ${d.checks} ${d.checks === 1 ? "person is" : "people are"} paid by check and not in the file` : ""}.
          </p>
          <table className="list">
            <thead><tr><th>Person</th><th>Account</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.employeeId}>
                  <td>{l.name}</td>
                  <td>{l.problem ? <span className="error">{l.problem}</span> : `ending ${l.accountLast4}`}</td>
                  <td className="num">{money(l.amountCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>Total</td><td /><td className="num">{money(d.totalCents)}</td></tr></tfoot>
          </table>
          <p className="error" role="alert">{err}</p>
          <div className="actions">
            <button type="button" className="btn" onClick={onClose}>Close</button>
            <button type="button" className="btn primary" disabled={!d.ready} onClick={download}><Download size={15} /> Download file</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
