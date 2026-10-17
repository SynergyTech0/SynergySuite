"use client";
// Referrals: every lead and deal a partner sent, where it stands, and the reward owed or paid.
// The table is shared with the partner page.
import { Download, Search, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { REFERRAL_STAGES, label, type Partner, type Referral, type ReferralTotals } from "@/lib/types";
import { referralTotals } from "@/lib/rewards";
import { api, formatDate, formatMoney } from "./client";
import { Modal } from "./Modal";
import { Badge, Facts, type AppCtx } from "./shared";

const terms = (r: { rewardType: string; rewardValue: string }) =>
  r.rewardType === "percent" ? `${Number(r.rewardValue)}% of the won deal` : `${formatMoney(r.rewardValue)} per won deal`;

export function rewardTerms(p: Pick<Partner, "rewardType" | "rewardValue">): string {
  return terms(p);
}

export function Totals({ t }: { t: ReferralTotals }) {
  return (
    <Facts items={[
      ["Sent", String(t.sent)], ["Won", String(t.won)], ["Earned", formatMoney(t.earned)],
      ["Paid", formatMoney(t.paid)], ["Outstanding", <strong key="o">{formatMoney(t.outstanding)}</strong>],
    ]} />
  );
}

/** Marks a won referral's reward paid. */
function PayDialog({ r, onClose, onDone }: { r: Referral; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState("");
  const today = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    <Modal title={`Pay ${r.partnerName}`} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = e.currentTarget;
          const get = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value;
          try {
            await api(`/api/referrals/${r.id}/payment`, { method: "PUT", json: { paidOn: get("paidOn"), amount: get("amount"), note: get("note") } });
            onDone();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <p className="muted small" style={{ marginTop: 0 }}>For {r.name || "a deleted record"}: {terms(r)}{r.dealValue ? ` on ${formatMoney(r.dealValue)}` : ""}.</p>
        <div className="grid2">
          <label><span>Paid on</span><input name="paidOn" type="date" required defaultValue={`${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`} /></label>
          <label><span>Amount (USD)</span><input name="amount" defaultValue={r.reward ?? ""} autoFocus /></label>
        </div>
        <label><span>Note (optional)</span><input name="note" maxLength={1000} placeholder="Check 1042, bank transfer…" /></label>
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Mark paid</button>
        </div>
      </form>
    </Modal>
  );
}

/** The referrals, each with its stage, deal value and reward, and Mark paid where it is owed. */
export function ReferralTable({ app, rows, onChange, showPartner = true }: { app: AppCtx; rows: Referral[]; onChange: () => void; showPartner?: boolean }) {
  const [paying, setPaying] = useState<Referral | null>(null);
  const open = (r: Referral) => (r.opportunityId ? app.go("opportunities", r.opportunityId) : r.leadId ? app.go("leads", r.leadId) : undefined);
  const unpay = async (r: Referral) => {
    try {
      await api(`/api/referrals/${r.id}/payment`, { method: "DELETE" });
      onChange();
    } catch (e) {
      app.say((e as Error).message);
    }
  };
  if (!rows.length) return <p className="muted small">No referrals yet.</p>;
  return (
    <>
      <table className="mini">
        <thead>
          <tr>
            <th>Referral</th>{showPartner ? <th>Partner</th> : null}<th>Stage</th><th className="num">Deal value</th><th className="num">Reward</th><th>Paid</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.leadId || r.opportunityId ? <button className="link" onClick={() => open(r)}>{r.name}</button> : <span className="muted">(deleted)</span>}
                {r.company ? <span className="muted small"> · {r.company}</span> : null}
              </td>
              {showPartner ? <td><button className="link" onClick={() => app.go("partners", r.partnerId)}>{r.partnerName}</button></td> : null}
              <td><Badge value={r.stage} /></td>
              <td className="num">{formatMoney(r.dealValue)}</td>
              <td className="num" title={terms(r)}>{r.reward === null ? <span className="muted">{r.rewardType === "percent" ? `${Number(r.rewardValue)}%` : formatMoney(r.rewardValue)}</span> : formatMoney(r.reward)}</td>
              <td>
                {r.paidOn ? (
                  <span title={r.paidNote || undefined}>
                    {formatMoney(r.paidAmount)} on {formatDate(r.paidOn)}
                    {r.payable ? <button className="iconbtn" aria-label={`Undo payment for ${r.name}`} title="Undo payment" onClick={() => void unpay(r)}><Undo2 size={13} /></button> : null}
                  </span>
                ) : r.owed !== "0.00" ? (
                  r.payable ? <button className="btn small" onClick={() => setPaying(r)}>Mark paid</button> : <span className="muted">Owed</span>
                ) : <span className="muted">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {paying ? <PayDialog r={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); onChange(); app.changed(); app.say("Reward marked paid"); }} /> : null}
    </>
  );
}

export function ReferralsView({ app }: { app: AppCtx }) {
  const [rows, setRows] = useState<Referral[] | null>(null);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("");
  const [unpaid, setUnpaid] = useState(false);

  const params = useCallback(() => {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    if (stage) p.set("stage", stage);
    if (unpaid) p.set("unpaid", "1");
    return p.toString();
  }, [query, stage, unpaid]);

  const load = useCallback(async () => {
    setRows(await api<Referral[]>(`/api/referrals?${params()}`));
  }, [params]);

  useEffect(() => {
    const t = window.setTimeout(() => void load().catch((e) => app.say(e.message)), query ? 200 : 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- app.version refreshes after changes elsewhere
  }, [load, query, app.version]);

  return (
    <div className="page">
      <div className="pagehead">
        <div className="grow">
          <h1>Referrals</h1>
          <p className="muted" style={{ margin: "2px 0 0" }}>Leads and deals your partners sent. Record who referred one on the lead or opportunity.</p>
        </div>
        <a className="iconbtn" href={`/api/export/referrals?${params()}`} title="Export these as CSV" aria-label="Export referrals as CSV"><Download size={17} /></a>
      </div>
      {rows ? <section className="panel"><Totals t={referralTotals(rows)} /></section> : null}
      <section className="panel">
        <div className="filters" style={{ marginBottom: 10 }}>
          <label className="search grow">
            <Search size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search referrals" aria-label="Search referrals" />
          </label>
          <select aria-label="Any stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">Any stage</option>
            {REFERRAL_STAGES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
          <label className="toggle"><input type="checkbox" checked={unpaid} onChange={(e) => setUnpaid(e.target.checked)} /> Reward owed</label>
        </div>
        {rows === null ? <p className="muted">Loading…</p> : <ReferralTable app={app} rows={rows} onChange={() => void load()} />}
      </section>
    </div>
  );
}
