"use client";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { TRUST_LABELS, api, money, person, shortDate, today } from "./client";
import type { Go } from "./LawApp";
import { Modal } from "./Modal";
import type { AppInfo, MatterSummary } from "./types";

export type Account = {
  id: string; name: string; bank: string; jurisdiction: string; iolta: boolean; archived: boolean; balanceCents: number;
  last_reconciled: string | null; reconcileEvery: number; reconcileOverdue: boolean;
  rule: { citation: string; url: string; depositDays: number; retentionYears: number } | null;
};

export type Line = {
  id: string; account_name: string; client_id: string; client_name: string; matter_id: string | null; number: string | null; kind: string;
  amountCents: number; runningCents: number; day: string; received_on: string | null; party: string; reference: string; memo: string;
  bill_number: string | null; books_status: string; books_error: string; entered_by: string; voided_at: string | null; void_reason: string;
  void_books_status: string; late: string | null;
};

type Bill = { id: string; number: string; total_cents: string; paidFromTrustCents: number };

/** Money in or out of trust. With `matter` set, the client and matter are fixed. */
export function TrustEntryDialog({
  kind, info, matter, onClose, onSaved,
}: { kind: "deposit" | "disbursement" | "fee_transfer"; info: AppInfo; matter?: { id: string; label: string }; onClose: () => void; onSaved: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [matters, setMatters] = useState<MatterSummary[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [v, setV] = useState({ accountId: "", matterId: matter?.id ?? "", amount: "", day: today(), receivedOn: today(), party: "", reference: "", memo: "", billId: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Account[]>("/api/trust/accounts").then((a) => {
      const open = a.filter((x) => !x.archived);
      setAccounts(open);
      if (open.length === 1) setV((cur) => ({ ...cur, accountId: open[0].id }));
    }).catch(() => {});
    if (!matter) api<MatterSummary[]>("/api/matters?view=all").then(setMatters).catch(() => {});
  }, [matter]);
  useEffect(() => {
    if (kind === "fee_transfer" && v.matterId) api<Bill[]>(`/api/matters/${v.matterId}/bills`).then(setBills).catch(() => setBills([]));
  }, [kind, v.matterId]);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const title = kind === "deposit" ? "Money into trust" : kind === "disbursement" ? "Pay out of trust" : "Move earned fees to the firm";
  return (
    <Modal title={title} onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("/api/trust/txns", { method: "POST", json: { ...v, kind, billId: v.billId || undefined, matterId: v.matterId || undefined } });
            onSaved();
          } catch (x) {
            setError((x as Error).message);
            setBusy(false);
          }
        }}
      >
        {!accounts.length && <p className="error">Set up a trust account first, under Trust accounts.</p>}
        <div className="row2">
          <label><span>Trust account</span><select value={v.accountId} onChange={set("accountId")} required><option value="">Pick one</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          {matter ? (
            <label><span>Matter</span><input value={matter.label} disabled /></label>
          ) : (
            <label><span>Matter</span><select value={v.matterId} onChange={set("matterId")} required><option value="">Pick one</option>{matters.map((m) => <option key={m.id} value={m.id}>{m.number} {m.title} ({m.client_name})</option>)}</select></label>
          )}
        </div>
        <div className="row3">
          <label><span>Amount</span><input inputMode="decimal" value={v.amount} onChange={set("amount")} required placeholder="0.00" /></label>
          <label><span>{kind === "deposit" ? "Deposited" : "Paid"}</span><input type="date" value={v.day} onChange={set("day")} required /></label>
          {kind === "deposit" && <label><span>Money arrived</span><input type="date" value={v.receivedOn} onChange={set("receivedOn")} /></label>}
        </div>
        <div className="row2">
          <label><span>{kind === "deposit" ? "From" : kind === "disbursement" ? "Paid to" : "Paid to (optional)"}</span><input value={v.party} onChange={set("party")} required={kind === "disbursement"} /></label>
          <label><span>Check or reference number</span><input value={v.reference} onChange={set("reference")} /></label>
        </div>
        {kind === "fee_transfer" && bills.length > 0 && (
          <label>
            <span>For bill</span>
            <select value={v.billId} onChange={set("billId")}>
              <option value="">Not against a bill</option>
              {bills.map((b) => <option key={b.id} value={b.id}>{b.number}: {money(Number(b.total_cents))}, {money(b.paidFromTrustCents)} paid from trust</option>)}
            </select>
          </label>
        )}
        <label><span>Memo</span><input value={v.memo} onChange={set("memo")} /></label>
        {kind !== "deposit" && <p className="muted small">Money only goes out of what this client and matter hold. Earned fees should already be billed to the client.</p>}
        {info.books && <p className="muted small">This is also posted to Books.</p>}
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Record</button>
        </div>
      </form>
    </Modal>
  );
}

export function LedgerTable({ rows, info, showClient, onChange }: { rows: Line[]; info: AppInfo; showClient?: boolean; onChange: () => void }) {
  const [voiding, setVoiding] = useState<Line | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  return (
    <>
      <div className="tablewrap">
        <table className="grid">
          <thead>
            <tr><th>Date</th><th>What</th>{showClient && <th>Client and matter</th>}<th>Who</th><th className="num">In</th><th className="num">Out</th><th className="num">Balance</th><th></th></tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((t) => (
              <tr key={t.id} className={t.voided_at ? "done" : ""}>
                <td>{shortDate(t.day)}</td>
                <td>
                  {TRUST_LABELS[t.kind]}{t.reference && <span className="muted small"> #{t.reference}</span>}{t.bill_number && <span className="muted small"> for {t.bill_number}</span>}
                  {t.memo && <div className="muted small">{t.memo}</div>}
                  {t.voided_at && <div className="error small">Void: {t.void_reason}</div>}
                  {t.late && !t.voided_at && <div className="warn small">{t.late}</div>}
                  {(t.books_status === "failed" || t.void_books_status === "failed") && (
                    <div className="error small">
                      Not in Books: {t.books_error}{" "}
                      {info.trustKeeper && <button className="linkbtn" onClick={async () => { await api(`/api/trust/txns/${t.id}`, { method: "POST", json: { action: "retry" } }); onChange(); }}>Send again</button>}
                    </div>
                  )}
                </td>
                {showClient && <td>{t.client_name}{t.number && <span className="muted small"> {t.number}</span>}</td>}
                <td>{t.party}</td>
                <td className="num">{t.kind === "deposit" ? money(t.amountCents) : ""}</td>
                <td className="num">{t.kind !== "deposit" ? money(t.amountCents) : ""}</td>
                <td className="num">{money(t.runningCents)}</td>
                <td>{info.trustKeeper && !t.voided_at && <button className="btn ghost small" onClick={() => { setVoiding(t); setReason(""); setError(""); }}>Void</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {voiding && (
        <Modal title="Void this entry" onClose={() => setVoiding(null)}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api(`/api/trust/txns/${voiding.id}`, { method: "POST", json: { action: "void", reason } });
                setVoiding(null);
                onChange();
              } catch (x) {
                setError((x as Error).message);
              }
            }}
          >
            <p>{TRUST_LABELS[voiding.kind]} of {money(voiding.amountCents)} on {shortDate(voiding.day)}. It stays on the ledger, marked void.</p>
            <label><span>Why</span><input value={reason} onChange={(e) => setReason(e.target.value)} required /></label>
            <p className="error">{error}</p>
            <div className="actions"><button type="button" className="btn" onClick={() => setVoiding(null)}>Cancel</button><button className="btn danger">Void</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

type Balance = { client_id: string; client_name: string; matter_id: string | null; number: string | null; matter_title: string | null; cents: string; last_day: string };
type Recon = { id: string; statement_day: string; statement_cents: string; outstanding_cents: string; book_cents: string; clients_cents: string; balanced: boolean; note: string; done_by: string };

export function TrustView({ info, go }: { info: AppInfo; go: Go }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [sel, setSel] = useState("");
  const [data, setData] = useState<{ ledger: Line[]; balances: Balance[] } | null>(null);
  const [recons, setRecons] = useState<Recon[]>([]);
  const [dialog, setDialog] = useState<"" | "account" | "reconcile" | "deposit" | "disbursement" | "fee_transfer">("");
  const [error, setError] = useState("");
  const loadAccounts = () =>
    api<Account[]>("/api/trust/accounts").then((a) => {
      setAccounts(a);
      setSel((cur) => cur || a[0]?.id || "");
    }).catch((e) => setError((e as Error).message));
  const loadAccount = () => {
    if (!sel) return;
    api<{ ledger: Line[]; balances: Balance[] }>(`/api/trust/accounts/${sel}`).then(setData).catch((e) => setError((e as Error).message));
    api<Recon[]>(`/api/trust/accounts/${sel}/reconcile`).then(setRecons).catch(() => {});
  };
  useEffect(() => {
    void loadAccounts();
  }, []);
  useEffect(() => {
    loadAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);
  const refresh = () => {
    setDialog("");
    void loadAccounts();
    loadAccount();
  };
  const acct = accounts?.find((a) => a.id === sel);
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Trust accounts</h1>
          <p className="sub muted">Client money the firm holds. Entries are never edited or deleted, only voided, and no client can go below zero.</p>
        </div>
        {info.trustKeeper && <button className="btn" onClick={() => setDialog("account")}><Plus size={16} /> New account</button>}
      </div>
      <div className="body">
        {error && <p className="error">{error}</p>}
        {!accounts ? <p className="muted">Loading…</p> : !accounts.length ? <div className="empty">No trust accounts yet.</div> : (
          <>
            <div className="toolbar">
              {accounts.map((a) => (
                <button key={a.id} className={`chip${a.id === sel ? " on" : ""}`} onClick={() => setSel(a.id)}>
                  {a.name} <b>{money(a.balanceCents)}</b>{a.reconcileOverdue && <span className="pill on_hold">reconcile</span>}{a.archived && <span className="pill">closed</span>}
                </button>
              ))}
            </div>
            {acct && (
              <>
                <p className="muted small">
                  {acct.bank && `${acct.bank} · `}{acct.iolta ? "IOLTA" : "Client trust"} · {acct.jurisdiction === "FED" ? "No state rules set" : info.jurisdictions.find((j) => j.code === acct.jurisdiction)?.name}
                  {acct.rule && <> · deposit within {acct.rule.depositDays} business day{acct.rule.depositDays === 1 ? "" : "s"}, reconcile every {acct.reconcileEvery} days, keep records {acct.rule.retentionYears} years (<a href={acct.rule.url} target="_blank" rel="noreferrer">{acct.rule.citation}</a>)</>}
                  {" · "}Last reconciled: {acct.last_reconciled ? shortDate(acct.last_reconciled) : "never"}
                </p>
                {info.trustKeeper && !acct.archived && (
                  <div className="toolbar">
                    <button className="btn primary" onClick={() => setDialog("deposit")}>Deposit</button>
                    <button className="btn" onClick={() => setDialog("disbursement")}>Pay out</button>
                    <button className="btn" onClick={() => setDialog("fee_transfer")}>Move earned fees</button>
                    <button className="btn" onClick={() => setDialog("reconcile")}>Reconcile</button>
                  </div>
                )}
                <section>
                  <h2>Client balances</h2>
                  {!data ? <p className="muted">Loading…</p> : !data.balances.length ? <p className="muted">Nobody has money in this account.</p> : (
                    <div className="tablewrap">
                      <table className="grid">
                        <thead><tr><th>Client</th><th>Matter</th><th>Last activity</th><th className="num">Holds</th></tr></thead>
                        <tbody>
                          {data.balances.map((b, i) => (
                            <tr key={i} className={b.matter_id ? "click" : ""} onClick={() => b.matter_id && go.matter(b.matter_id, "trust")}>
                              <td>{b.client_name}</td>
                              <td>{b.number ? `${b.number} ${b.matter_title}` : <span className="muted">Not on a matter</span>}</td>
                              <td>{shortDate(b.last_day)}</td>
                              <td className={`num${Number(b.cents) < 0 ? " error" : ""}`}>{money(Number(b.cents))}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot><tr><td colSpan={3}>Total</td><td className="num">{money(data.balances.reduce((s, b) => s + Number(b.cents), 0))}</td></tr></tfoot>
                      </table>
                    </div>
                  )}
                </section>
                <section>
                  <h2>Ledger</h2>
                  {data && (data.ledger.length ? <LedgerTable rows={data.ledger} info={info} showClient onChange={loadAccount} /> : <p className="muted">No entries yet.</p>)}
                </section>
                {recons.length > 0 && (
                  <section>
                    <h2>Reconciliations</h2>
                    <div className="tablewrap">
                      <table className="grid">
                        <thead><tr><th>Statement</th><th className="num">Bank, adjusted</th><th className="num">Ledger</th><th className="num">Clients</th><th>Result</th><th>By</th></tr></thead>
                        <tbody>
                          {recons.map((r) => (
                            <tr key={r.id}>
                              <td>{shortDate(r.statement_day)}</td>
                              <td className="num">{money(Number(r.statement_cents) - Number(r.outstanding_cents))}</td>
                              <td className="num">{money(Number(r.book_cents))}</td>
                              <td className="num">{money(Number(r.clients_cents))}</td>
                              <td>{r.balanced ? <span className="pill approved">balanced</span> : <span className="pill rejected">off</span>}{r.note && <div className="muted small">{r.note}</div>}</td>
                              <td className="muted">{person(r.done_by, info.email)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </>
            )}
          </>
        )}
      </div>
      {dialog === "account" && <AccountDialog info={info} onClose={() => setDialog("")} onSaved={refresh} />}
      {dialog === "reconcile" && acct && <ReconcileDialog account={acct} onClose={() => setDialog("")} onSaved={refresh} />}
      {(dialog === "deposit" || dialog === "disbursement" || dialog === "fee_transfer") && (
        <TrustEntryDialog kind={dialog} info={info} onClose={() => setDialog("")} onSaved={refresh} />
      )}
    </>
  );
}

function AccountDialog({ info, onClose, onSaved }: { info: AppInfo; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ name: "IOLTA", bank: "", jurisdiction: "FED", iolta: true });
  const [error, setError] = useState("");
  return (
    <Modal title="New trust account" onClose={onClose}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); try { await api("/api/trust/accounts", { method: "POST", json: v }); onSaved(); } catch (x) { setError((x as Error).message); } }}>
        <label><span>Name</span><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></label>
        <label><span>Bank</span><input value={v.bank} onChange={(e) => setV({ ...v, bank: e.target.value })} /></label>
        <label>
          <span>State whose trust rules it follows</span>
          <select value={v.jurisdiction} onChange={(e) => setV({ ...v, jurisdiction: e.target.value })}>
            <option value="FED">None set</option>
            {info.jurisdictions.map((j) => <option key={j.code} value={j.code}>{j.name}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={v.iolta} onChange={(e) => setV({ ...v, iolta: e.target.checked })} /> Pooled IOLTA account</label>
        <p className="error">{error}</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Create</button></div>
      </form>
    </Modal>
  );
}

type ReconResult = { adjustedCents: number; bookCents: number; clientsCents: number; negativeClients: number; balanced: boolean };

function ReconcileDialog({ account, onClose, onSaved }: { account: Account; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ statementDay: today(), statementBalance: "", outstandingChecks: "", depositsInTransit: "", note: "" });
  const [out, setOut] = useState<ReconResult | null>(null);
  const [error, setError] = useState("");
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Modal title={`Reconcile ${account.name}`} onClose={out ? onSaved : onClose} wide>
      {out ? (
        <div className="form">
          <table className="grid">
            <tbody>
              <tr><td>Bank statement, adjusted</td><td className="num">{money(out.adjustedCents)}</td></tr>
              <tr><td>Trust ledger</td><td className="num">{money(out.bookCents)}</td></tr>
              <tr><td>Sum of client balances</td><td className="num">{money(out.clientsCents)}</td></tr>
            </tbody>
          </table>
          {out.balanced ? <p className="ok">All three agree. Recorded.</p> : (
            <p className="error">
              They don&apos;t agree{out.negativeClients ? `, and ${out.negativeClients} client balance${out.negativeClients === 1 ? " is" : "s are"} below zero` : ""}. It&apos;s recorded as off; find the difference and reconcile again.
            </p>
          )}
          <div className="actions"><button className="btn primary" onClick={onSaved}>Done</button></div>
        </div>
      ) : (
        <form className="form" onSubmit={async (e) => { e.preventDefault(); try { setOut(await api<ReconResult>(`/api/trust/accounts/${account.id}/reconcile`, { method: "POST", json: v })); } catch (x) { setError((x as Error).message); } }}>
          <div className="row2">
            <label><span>Statement date</span><input type="date" value={v.statementDay} onChange={set("statementDay")} required /></label>
            <label><span>Statement ending balance</span><input inputMode="decimal" value={v.statementBalance} onChange={set("statementBalance")} required /></label>
          </div>
          <div className="row2">
            <label><span>Checks written but not cleared</span><input inputMode="decimal" value={v.outstandingChecks} onChange={set("outstandingChecks")} placeholder="0.00" /></label>
            <label><span>Deposits not yet on the statement</span><input inputMode="decimal" value={v.depositsInTransit} onChange={set("depositsInTransit")} placeholder="0.00" /></label>
          </div>
          <label><span>Note</span><input value={v.note} onChange={set("note")} /></label>
          <p className="error">{error}</p>
          <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Reconcile</button></div>
        </form>
      )}
    </Modal>
  );
}
