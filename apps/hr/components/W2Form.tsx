"use client";
import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { api, money } from "./client";

type W2 = {
  year: number; wagesCents: number; federalCents: number; socialSecurityWagesCents: number; socialSecurityCents: number; medicareWagesCents: number;
  medicareCents: number; box12: Record<string, number>; retirementPlan: boolean; states: { state: string; wagesCents: number; taxCents: number }[];
  section125Cents: number;
};
type Doc = {
  w2: W2;
  employer: { ein: string; name: string; address1: string; address2: string; city: string; state: string; zip: string; stateIds: Record<string, string> };
  employee: { name: string; ssnMasked: string; address1: string; address2: string; city: string; state: string; zip: string };
};

const amount = (c: number) => money(c).replace("$", "");

function Box({ n, label, children, wide }: { n: string; label: string; children?: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`w2box${wide ? " wide" : ""}`}>
      <div className="w2label"><b>{n}</b> {label}</div>
      <div className="w2value">{children}</div>
    </div>
  );
}

/** Form W-2, employee copies B, C and 2: one per page when printed. */
export function W2Form({ id, year }: { id: string; year: string }) {
  const [d, setD] = useState<Doc | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<Doc>(`/api/w2/${id}?year=${encodeURIComponent(year)}`).then(setD, (e) => setErr((e as Error).message));
  }, [id, year]);
  if (err) return <div className="pad"><p className="error">{err}</p></div>;
  if (!d) return <div className="pad muted">Loading…</div>;
  const { w2, employer: er, employee: ee } = d;
  const box12 = Object.entries(w2.box12).filter(([, v]) => v > 0);
  const copies = [
    ["Copy B", "To be filed with employee's federal tax return."],
    ["Copy C", "For employee's records."],
    ["Copy 2", "To be filed with employee's state, city or local income tax return."],
  ];
  return (
    <div className="stub">
      <div className="row noprint" style={{ justifyContent: "space-between" }}>
        <span className="muted small">Copy A goes to the Social Security Administration in the W-2 file from Payroll.</span>
        <button className="btn" onClick={() => window.print()}><Printer size={16} /> Print</button>
      </div>
      {copies.map(([copy, note]) => (
        <section key={copy} className="w2">
          <div className="w2head"><b>Form W-2 Wage and Tax Statement {w2.year}</b><span className="small">{copy}: {note}</span></div>
          <div className="w2grid">
            <Box n="a" label="Employee's social security number">{ee.ssnMasked || "Not on file"}</Box>
            <Box n="b" label="Employer identification number (EIN)">{er.ein}</Box>
            <Box n="1" label="Wages, tips, other compensation">{amount(w2.wagesCents)}</Box>
            <Box n="2" label="Federal income tax withheld">{amount(w2.federalCents)}</Box>
            <Box n="c" label="Employer's name, address and ZIP code" wide>
              {er.name}<br />{[er.address1, er.address2].filter(Boolean).join(", ")}<br />{er.city}{er.city && ", "}{er.state} {er.zip}
            </Box>
            <Box n="3" label="Social security wages">{amount(w2.socialSecurityWagesCents)}</Box>
            <Box n="4" label="Social security tax withheld">{amount(w2.socialSecurityCents)}</Box>
            <Box n="5" label="Medicare wages and tips">{amount(w2.medicareWagesCents)}</Box>
            <Box n="6" label="Medicare tax withheld">{amount(w2.medicareCents)}</Box>
            <Box n="e/f" label="Employee's name, address and ZIP code" wide>
              {ee.name}<br />{[ee.address1, ee.address2].filter(Boolean).join(", ")}<br />{ee.city}{ee.city && ", "}{ee.state} {ee.zip}
            </Box>
            <Box n="12" label="See instructions for box 12">
              {box12.length ? box12.map(([k, v]) => <div key={k}>{k} {amount(v)}</div>) : ""}
            </Box>
            <Box n="13" label="Retirement plan">{w2.retirementPlan ? "X" : ""}</Box>
            <Box n="14" label="Other">{w2.section125Cents ? `125 ${amount(w2.section125Cents)}` : ""}</Box>
          </div>
          <table className="list w2states">
            <thead><tr><th>15 State</th><th>Employer's state ID number</th><th className="num">16 State wages</th><th className="num">17 State income tax</th></tr></thead>
            <tbody>
              {w2.states.length ? w2.states.map((s) => (
                <tr key={s.state}><td>{s.state}</td><td>{er.stateIds[s.state] ?? ""}</td><td className="num">{amount(s.wagesCents)}</td><td className="num">{amount(s.taxCents)}</td></tr>
              )) : <tr><td colSpan={4} className="muted">No state income tax</td></tr>}
            </tbody>
          </table>
          <div className="small muted">Department of the Treasury, Internal Revenue Service</div>
        </section>
      ))}
    </div>
  );
}
