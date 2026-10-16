"use client";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { api, money } from "./client";

type W2 = {
  wagesCents: number; federalCents: number; socialSecurityWagesCents: number; socialSecurityCents: number; medicareWagesCents: number; medicareCents: number;
  box12: Record<string, number>; states: { state: string; wagesCents: number; taxCents: number }[];
};
type F941 = {
  employees: number; wagesCents: number; federalCents: number; socialSecurityWagesCents: number; socialSecurityTaxCents: number; medicareWagesCents: number;
  medicareTaxCents: number; additionalMedicareWagesCents: number; additionalMedicareTaxCents: number; fractionsOfCentsCents: number; totalTaxCents: number;
  months: [number, number, number];
};
type StateQ = { state: string; employees: number; wagesCents: number; withheldCents: number; grossCents: number; sutaCents: number };
type Forms = {
  year: number;
  w2s: { employeeId: string; name: string; ssnLast4: string; w2: W2; missing: string[] }[];
  w3: W2 & { forms: number };
  quarters: { quarter: number; form941: F941; states: StateQ[] }[];
  form940: { totalPaymentsCents: number; exemptCents: number; overBaseCents: number; taxableWagesCents: number; futaTaxCents: number; quarters: number[] };
  efw2Missing: string[];
};

async function download(url: string, fallback: string, onError: (m: string) => void) {
  const res = await fetch(url);
  if (!res.ok) {
    onError(((await res.json().catch(() => ({}))) as { error?: string }).error || `Request failed (${res.status})`);
    return;
  }
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallback;
  a.click();
  URL.revokeObjectURL(href);
}

/** W-2s, the SSA file, Form 941 by quarter, Form 940 and state figures for a year of paid runs. */
export function TaxForms({ reload }: { reload: unknown }) {
  const thisYear = new Date().getFullYear();
  // Through January, last year's W-2s are what's due.
  const [year, setYear] = useState(new Date().getMonth() === 0 ? thisYear - 1 : thisYear);
  const [f, setF] = useState<Forms | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<Forms>(`/api/payroll/forms?year=${year}`).then((x) => { setF(x); setErr(""); }, (e) => setErr((e as Error).message));
  }, [year, reload]);

  const missingPeople = f?.w2s.filter((r) => r.missing.length) ?? [];
  return (
    <section className="section">
      <div className="row">
        <h3 style={{ margin: 0 }}>Tax forms</h3>
        <select className="btn small right" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
          {[0, 1, 2].map((d) => <option key={d}>{thisYear - d}</option>)}
        </select>
      </div>
      <p className="small muted">
        Worked out from paid runs. Payroll fills in the forms; you file and pay them yourself, through EFTPS and your state&apos;s site.
      </p>
      {err && <p className="error" role="alert">{err}</p>}
      {f && (
        <>
          <h4>Form 941, each quarter</h4>
          <div style={{ overflowX: "auto" }}>
            <table className="list">
              <thead><tr><th>Line</th>{f.quarters.map((q) => <th key={q.quarter} className="num">Q{q.quarter}</th>)}</tr></thead>
              <tbody>
                {([
                  ["1 Employees paid on the 12th", (x: F941) => String(x.employees)],
                  ["2 Wages, tips, other pay", (x: F941) => money(x.wagesCents)],
                  ["3 Federal income tax withheld", (x: F941) => money(x.federalCents)],
                  ["5a Social Security wages", (x: F941) => money(x.socialSecurityWagesCents)],
                  ["5a × 12.4%", (x: F941) => money(x.socialSecurityTaxCents)],
                  ["5c Medicare wages", (x: F941) => money(x.medicareWagesCents)],
                  ["5c × 2.9%", (x: F941) => money(x.medicareTaxCents)],
                  ["5d Additional Medicare wages", (x: F941) => money(x.additionalMedicareWagesCents)],
                  ["5d × 0.9%", (x: F941) => money(x.additionalMedicareTaxCents)],
                  ["7 Fractions of cents", (x: F941) => money(x.fractionsOfCentsCents)],
                  ["12 Total taxes", (x: F941) => money(x.totalTaxCents)],
                  ["16 Month 1", (x: F941) => money(x.months[0])],
                  ["16 Month 2", (x: F941) => money(x.months[1])],
                  ["16 Month 3", (x: F941) => money(x.months[2])],
                ] as [string, (x: F941) => string][]).map(([label, fn]) => (
                  <tr key={label}><td>{label}</td>{f.quarters.map((q) => <td key={q.quarter} className="num">{fn(q.form941)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4>Form 940, the year</h4>
          <table className="list">
            <tbody>
              <tr><td>3 Total payments to employees</td><td className="num">{money(f.form940.totalPaymentsCents)}</td></tr>
              <tr><td>4 Exempt payments (Section 125 benefits)</td><td className="num">{money(f.form940.exemptCents)}</td></tr>
              <tr><td>5 Payments over $7,000 per employee</td><td className="num">{money(f.form940.overBaseCents)}</td></tr>
              <tr><td>7 Taxable FUTA wages</td><td className="num">{money(f.form940.taxableWagesCents)}</td></tr>
              <tr><td>8 FUTA tax (0.6%)</td><td className="num">{money(f.form940.futaTaxCents)}</td></tr>
              <tr><td>16 By quarter</td><td className="num">{f.form940.quarters.map((x) => money(x)).join(" · ")}</td></tr>
            </tbody>
          </table>

          <h4>State withholding and unemployment, each quarter</h4>
          {f.quarters.every((q) => !q.states.length) ? <p className="empty">No paid runs in {f.year}.</p> : (
            <table className="list">
              <thead><tr><th>Quarter</th><th>State</th><th className="num">People</th><th className="num">Taxable wages</th><th className="num">Withheld</th><th className="num">Gross wages</th><th className="num">Unemployment</th></tr></thead>
              <tbody>
                {f.quarters.flatMap((q) => q.states.map((s) => (
                  <tr key={`${q.quarter}${s.state}`}>
                    <td>Q{q.quarter}</td><td>{s.state}</td><td className="num">{s.employees}</td><td className="num">{money(s.wagesCents)}</td>
                    <td className="num">{money(s.withheldCents)}</td><td className="num">{money(s.grossCents)}</td><td className="num">{money(s.sutaCents)}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          )}

          <div className="row" style={{ marginTop: 16 }}>
            <h4 style={{ margin: 0 }}>W-2s</h4>
            <button
              className="btn small right"
              disabled={!f.w2s.length || f.efw2Missing.length > 0 || missingPeople.length > 0}
              onClick={() => download(`/api/payroll/forms/efw2?year=${f.year}`, `W2REPORT-${f.year}.txt`, setErr)}
            >
              <Download size={14} /> W-2 file for the SSA
            </button>
          </div>
          {(f.efw2Missing.length > 0 || missingPeople.length > 0) && f.w2s.length > 0 && (
            <div className="banner small">
              The SSA file needs {[...f.efw2Missing, ...missingPeople.map((r) => `${r.name}'s ${r.missing.join(", ")}`)].join("; ")}.
              Company details are under Company and bank; people&apos;s are on their Pay tab.
            </div>
          )}
          {f.w2s.length === 0 ? <p className="empty">No paid runs in {f.year}.</p> : (
            <div style={{ overflowX: "auto" }}>
              <table className="list">
                <thead><tr><th>Person</th><th className="num">1 Wages</th><th className="num">2 Federal</th><th className="num">3 SS wages</th><th className="num">5 Medicare wages</th><th className="num">12</th><th>15-17</th><th /></tr></thead>
                <tbody>
                  {f.w2s.map((r) => (
                    <tr key={r.employeeId}>
                      <td>{r.name}{r.ssnLast4 && <div className="small muted">SSN ending {r.ssnLast4}</div>}</td>
                      <td className="num">{money(r.w2.wagesCents)}</td><td className="num">{money(r.w2.federalCents)}</td>
                      <td className="num">{money(r.w2.socialSecurityWagesCents)}</td><td className="num">{money(r.w2.medicareWagesCents)}</td>
                      <td className="num small">{Object.entries(r.w2.box12).map(([k, v]) => `${k} ${money(v)}`).join(", ")}</td>
                      <td className="small">{r.w2.states.map((s) => `${s.state} ${money(s.taxCents)}`).join(", ")}</td>
                      <td className="num"><a href={`/w2/${r.employeeId}?year=${f.year}`} target="_blank" rel="noreferrer">W-2</a></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>W-3 total, {f.w3.forms} forms</td><td className="num">{money(f.w3.wagesCents)}</td><td className="num">{money(f.w3.federalCents)}</td>
                    <td className="num">{money(f.w3.socialSecurityWagesCents)}</td><td className="num">{money(f.w3.medicareWagesCents)}</td>
                    <td className="num small">{Object.entries(f.w3.box12).map(([k, v]) => `${k} ${money(v)}`).join(", ")}</td><td /><td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="small muted">
            Employees can print their own W-2 from Home once a year&apos;s runs are paid. Social Security numbers are shortened to the last four on printed copies;
            Copy A goes to the SSA in the file. Local taxes, tips and third-party sick pay aren&apos;t tracked and are left at zero.
          </p>
        </>
      )}
    </section>
  );
}
