"use client";
import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { api, dayLabel, money, rangeLabel } from "./client";

type Line = { code: string; label: string; amountCents: number; hours?: number; rateCents?: number; employerCents?: number };
type Stub = {
  companyName: string;
  run: { number: number; periodStart: string; periodEnd: string; payDate: string; status: string };
  check: {
    employeeName: string; employeeEmail: string;
    profile: { title?: string; department?: string; paymentMethod?: string; accountLast4?: string; filingStatus?: string };
    result: { earnings: Line[]; deductions: Line[]; taxes: Line[]; grossCents: number; deductionsCents: number; taxesCents: number; netCents: number; taxYear: number };
  };
  ytd: { grossCents: number; deductions: Record<string, number>; taxes: Record<string, number>; netCents: number };
};

export function PayStub({ id }: { id: string }) {
  const [s, setS] = useState<Stub | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<Stub>(`/api/stubs/${id}`).then(setS, (e) => setErr((e as Error).message));
  }, [id]);
  if (err) return <div className="pad"><p className="error">{err}</p></div>;
  if (!s) return <div className="pad muted">Loading…</div>;
  const r = s.check.result;
  const p = s.check.profile;
  return (
    <div className="stub">
      <div className="row noprint" style={{ justifyContent: "flex-end" }}>
        <button className="btn" onClick={() => window.print()}><Printer size={16} /> Print</button>
      </div>
      {s.run.status !== "paid" && <div className="banner">This is a preview: pay run {s.run.number} is {s.run.status}.</div>}
      <div className="stubgrid" style={{ marginTop: 12 }}>
        <div>
          <h1>{s.companyName || "Pay stub"}</h1>
          <div className="muted">Pay run {s.run.number}</div>
        </div>
        <dl className="facts">
          <dt>Pay date</dt><dd>{dayLabel(s.run.payDate)}</dd>
          <dt>Pay period</dt><dd>{rangeLabel(s.run.periodStart, s.run.periodEnd)}</dd>
          <dt>Take-home pay</dt><dd><b>{money(r.netCents)}</b></dd>
        </dl>
        <div>
          <b>{s.check.employeeName}</b>
          <div className="muted">{[p.title, p.department].filter(Boolean).join(", ")}</div>
          <div className="muted">{s.check.employeeEmail}</div>
        </div>
        <div className="muted small">
          {p.paymentMethod === "check" ? "Paid by check" : `Direct deposit${p.accountLast4 ? ` to account ending ${p.accountLast4}` : ""}`}
        </div>
      </div>

      <Section title="Earnings" lines={r.earnings} total={r.grossCents} ytd={{ total: s.ytd.grossCents }} showHours />
      <Section title="Taxes" lines={r.taxes} total={r.taxesCents} ytd={{ byCode: s.ytd.taxes, total: Object.values(s.ytd.taxes).reduce((a, b) => a + b, 0) }} />
      {r.deductions.length > 0 && <Section title="Deductions" lines={r.deductions} total={r.deductionsCents} ytd={{ byCode: s.ytd.deductions, total: Object.values(s.ytd.deductions).reduce((a, b) => a + b, 0) }} />}

      <table className="list" style={{ marginTop: 16 }}>
        <tbody><tr><td><b>Take-home pay</b></td><td className="num"><b>{money(r.netCents)}</b></td><td className="num muted">{money(s.ytd.netCents)} this year</td></tr></tbody>
      </table>
      <p className="small muted" style={{ marginTop: 20 }}>Federal withholding uses {r.taxYear} IRS figures. Questions about your pay? Ask HR.</p>
    </div>
  );
}

function Section({ title, lines, total, ytd, showHours }: {
  title: string; lines: Line[]; total: number; ytd: { byCode?: Record<string, number>; total: number }; showHours?: boolean;
}) {
  return (
    <table className="list" style={{ marginTop: 20 }}>
      <thead><tr><th>{title}</th>{showHours && <th className="num">Hours</th>}{showHours && <th className="num">Rate</th>}<th className="num">This paycheck</th><th className="num">This year</th></tr></thead>
      <tbody>
        {lines.filter((l) => l.amountCents || l.hours).map((l) => (
          <tr key={l.code}>
            <td>{l.label}</td>
            {showHours && <td className="num">{l.hours ?? ""}</td>}
            {showHours && <td className="num">{l.rateCents ? money(l.rateCents) : ""}</td>}
            <td className="num">{money(l.amountCents)}</td>
            <td className="num">{ytd.byCode ? money(ytd.byCode[l.code] ?? 0) : ""}</td>
          </tr>
        ))}
      </tbody>
      <tfoot><tr><td>Total</td>{showHours && <td />}{showHours && <td />}<td className="num">{money(total)}</td><td className="num">{money(ytd.total)}</td></tr></tfoot>
    </table>
  );
}
