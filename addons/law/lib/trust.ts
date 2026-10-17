import type { Me } from "./api";
import { booksConfigured, post, trustLines } from "./books";
import { type Tq, q, tx } from "./db";
import { CODES, businessDaysBetween, jurisdiction } from "./jurisdictions";
import { access, dayOrNull, isAdmin, isTrustKeeper, logEvent } from "./law";
import { UserError, cents, text, uuidish } from "./util";

/**
 * Client trust (IOLTA) accounting. Money comes in as deposits and goes out as disbursements (to
 * the client or a third party) or as transfers of earned fees to the firm, each against a client
 * and usually a matter. No client's or matter's balance may go below zero, so an outgoing entry
 * is checked under a lock on the account. Entries are never edited or deleted; a mistake is voided,
 * which keeps it on the ledger. Reconciliation compares the bank statement with the ledger and the
 * sum of client balances (three-way), as most states require monthly.
 */

export type Account = {
  id: string; name: string; bank: string; jurisdiction: string; iolta: boolean; books_account: string; archived: boolean;
  balance_cents: string; last_reconciled: string | null; created_at: Date;
};

const BAL = `COALESCE(sum(CASE WHEN x.kind = 'deposit' THEN x.amount_cents ELSE -x.amount_cents END), 0)`;

function requireKeeper(me: Me) {
  if (!isTrustKeeper(me.email)) throw new UserError("Only the firm's trust account keepers can do this", 403);
}

export async function listAccounts(me: Me) {
  const rows = await q<Account>(
    `SELECT a.id, a.name, a.bank, a.jurisdiction, a.iolta, a.books_account, a.archived, a.created_at,
       (SELECT ${BAL} FROM trust_txns x WHERE x.account_id = a.id AND x.voided_at IS NULL) AS balance_cents,
       (SELECT to_char(max(r.statement_day), 'YYYY-MM-DD') FROM reconciliations r WHERE r.account_id = a.id) AS last_reconciled
     FROM trust_accounts a ORDER BY a.archived, a.name`,
  );
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((a) => {
    const j = jurisdiction(a.jurisdiction);
    const every = j?.reconcileDays ?? 30;
    const since = a.last_reconciled ? Math.round((Date.parse(today) - Date.parse(a.last_reconciled)) / 86_400_000) : null;
    const hasMoney = Number(a.balance_cents) !== 0 || a.last_reconciled !== null;
    return {
      ...a,
      balanceCents: Number(a.balance_cents),
      reconcileEvery: every,
      reconcileOverdue: !a.archived && hasMoney && (since === null || since > every),
      rule: j ? { citation: j.citation, url: j.url, depositDays: j.depositDays, retentionYears: j.retentionYears } : null,
    };
  });
}

export async function createAccount(me: Me, b: Record<string, unknown>) {
  requireKeeper(me);
  const name = text(b.name, 120);
  if (!name) throw new UserError("Name the account");
  const j = String(b.jurisdiction ?? "FED").toUpperCase();
  if (!CODES.includes(j)) throw new UserError("Pick the state whose rules the account follows");
  const [a] = await q<{ id: string }>(
    `INSERT INTO trust_accounts (name, bank, jurisdiction, iolta, books_account, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [name, text(b.bank, 120), j, b.iolta !== false, text(b.booksAccount, 20), me.email],
  );
  return a;
}

export async function updateAccount(me: Me, id: string, b: Record<string, unknown>) {
  requireKeeper(me);
  if (!uuidish(id)) throw new UserError("Not found", 404);
  const j = b.jurisdiction === undefined ? null : String(b.jurisdiction).toUpperCase();
  if (j !== null && !CODES.includes(j)) throw new UserError("Pick the state whose rules the account follows");
  if (b.archived === true) {
    const [{ cents: bal }] = await q<{ cents: string }>(`SELECT ${BAL} AS cents FROM trust_txns x WHERE x.account_id = $1 AND x.voided_at IS NULL`, [id]);
    if (Number(bal) !== 0) throw new UserError("The account still holds client money", 409);
  }
  const rows = await q(
    `UPDATE trust_accounts SET name = COALESCE(NULLIF($2, ''), name), bank = COALESCE($3, bank), jurisdiction = COALESCE($4, jurisdiction),
       archived = COALESCE($5, archived) WHERE id = $1 RETURNING id`,
    [id, b.name === undefined ? "" : text(b.name, 120), b.bank === undefined ? null : text(b.bank, 120), j,
      b.archived === undefined ? null : !!b.archived],
  );
  if (!rows.length) throw new UserError("Not found", 404);
}

export type Txn = {
  id: string; account_id: string; account_name: string; client_id: string; client_name: string; matter_id: string | null; number: string | null;
  matter_title: string | null; kind: string; amount_cents: string; day: string; received_on: string | null; party: string; reference: string;
  memo: string; bill_id: string | null; bill_number: string | null; books_status: string; books_error: string; entered_by: string;
  entered_at: Date; voided_at: Date | null; voided_by: string | null; void_reason: string; void_books_status: string; jurisdiction: string;
};

const TXN_COLS = `x.id, x.account_id, a.name AS account_name, a.jurisdiction, x.client_id, c.name AS client_name, x.matter_id, m.number,
  m.title AS matter_title, x.kind, x.amount_cents, to_char(x.day, 'YYYY-MM-DD') AS day, to_char(x.received_on, 'YYYY-MM-DD') AS received_on,
  x.party, x.reference, x.memo, x.bill_id, b.number AS bill_number, x.books_status, x.books_error, x.entered_by, x.entered_at,
  x.voided_at, x.voided_by, x.void_reason, x.void_books_status`;
const TXN_FROM = `trust_txns x JOIN trust_accounts a ON a.id = x.account_id JOIN clients c ON c.id = x.client_id
  LEFT JOIN matters m ON m.id = x.matter_id LEFT JOIN bills b ON b.id = x.bill_id`;

/** A deposit made later than the account's state allows after the money arrived. */
function lateness(t: Txn): string | null {
  if (t.kind !== "deposit" || !t.received_on) return null;
  const j = jurisdiction(t.jurisdiction);
  if (!j) return null;
  const n = businessDaysBetween(t.received_on, t.day);
  return n > j.depositDays ? `Deposited ${n} business days after it arrived; ${j.name} allows ${j.depositDays}` : null;
}

/** Ledger lines oldest first with the running balance. */
function withRunning(rows: Txn[]) {
  let bal = 0;
  return rows.map((t) => {
    if (!t.voided_at) bal += (t.kind === "deposit" ? 1 : -1) * Number(t.amount_cents);
    return { ...t, amountCents: Number(t.amount_cents), runningCents: bal, late: lateness(t) };
  });
}

/** The ledger for an account (keepers and administrators), or for one matter (anyone on it). */
export async function ledger(me: Me, opts: { accountId?: string; matterId?: string; clientId?: string }) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.matterId) {
    await access(me.email, opts.matterId);
    params.push(opts.matterId);
    where.push(`x.matter_id = $${params.length}`);
  } else {
    if (!isTrustKeeper(me.email) && !isAdmin(me.email)) throw new UserError("Only the firm's trust account keepers see the whole ledger", 403);
    if (opts.accountId) {
      if (!uuidish(opts.accountId)) throw new UserError("Not found", 404);
      params.push(opts.accountId);
      where.push(`x.account_id = $${params.length}`);
    }
    if (opts.clientId) {
      if (!uuidish(opts.clientId)) throw new UserError("Not found", 404);
      params.push(opts.clientId);
      where.push(`x.client_id = $${params.length}`);
    }
  }
  const rows = await q<Txn>(
    `SELECT ${TXN_COLS} FROM ${TXN_FROM} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY x.day, x.entered_at LIMIT 10000`,
    params,
  );
  return withRunning(rows);
}

/** What each client (and each of their matters) holds in an account. */
export async function balances(me: Me, accountId: string) {
  if (!isTrustKeeper(me.email) && !isAdmin(me.email)) throw new UserError("Only the firm's trust account keepers see client balances", 403);
  if (!uuidish(accountId)) throw new UserError("Not found", 404);
  return q<{ client_id: string; client_name: string; matter_id: string | null; number: string | null; matter_title: string | null; cents: string; last_day: string }>(
    `SELECT x.client_id, c.name AS client_name, x.matter_id, m.number, m.title AS matter_title, ${BAL} AS cents, to_char(max(x.day), 'YYYY-MM-DD') AS last_day
     FROM trust_txns x JOIN clients c ON c.id = x.client_id LEFT JOIN matters m ON m.id = x.matter_id
     WHERE x.account_id = $1 AND x.voided_at IS NULL GROUP BY x.client_id, c.name, x.matter_id, m.number, m.title
     HAVING ${BAL} <> 0 ORDER BY lower(c.name), m.number`,
    [accountId],
  );
}

async function heldBy(tq: Tq, accountId: string, clientId: string, matterId: string | null) {
  const [r] = await tq<{ client: string; matter: string }>(
    `SELECT COALESCE(sum(CASE WHEN kind = 'deposit' THEN amount_cents ELSE -amount_cents END), 0) AS client,
       COALESCE(sum(CASE WHEN matter_id IS NOT DISTINCT FROM $3::uuid THEN CASE WHEN kind = 'deposit' THEN amount_cents ELSE -amount_cents END END), 0) AS matter
     FROM trust_txns WHERE account_id = $1 AND client_id = $2 AND voided_at IS NULL`,
    [accountId, clientId, matterId],
  );
  return { client: Number(r.client), matter: Number(r.matter) };
}

function money(c: number): string {
  return (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Records a deposit, disbursement or earned-fee transfer, then posts it to Books when connected. */
export async function record(me: Me, b: Record<string, unknown>) {
  requireKeeper(me);
  const kind = String(b.kind);
  if (!["deposit", "disbursement", "fee_transfer"].includes(kind)) throw new UserError("Pick deposit, disbursement or fee transfer");
  const accountId = String(b.accountId ?? "");
  if (!uuidish(accountId)) throw new UserError("Pick the trust account");
  const amount = cents(b.amount, "Amount") ?? 0;
  if (amount <= 0) throw new UserError("Enter the amount");
  const day = dayOrNull(b.day, "Date") ?? new Date().toISOString().slice(0, 10);
  const receivedOn = kind === "deposit" ? dayOrNull(b.receivedOn, "Received") : null;
  if (receivedOn && receivedOn > day) throw new UserError("Money can't be deposited before it arrived");
  let matterId = b.matterId ? String(b.matterId) : null;
  let clientId = b.clientId ? String(b.clientId) : "";
  if (matterId) {
    if (!uuidish(matterId)) throw new UserError("Not found", 404);
    const [m] = await q<{ client_id: string; status: string }>(`SELECT client_id, status FROM matters WHERE id = $1 AND held_deleted_at IS NULL`, [matterId]);
    if (!m) throw new UserError("That matter isn't there", 404);
    if (clientId && clientId !== m.client_id) throw new UserError("That matter belongs to another client");
    clientId = m.client_id;
  }
  if (!uuidish(clientId)) throw new UserError("Pick the client");
  const party = text(b.party, 200);
  if (kind === "disbursement" && !party) throw new UserError("Say who was paid");
  let billId = b.billId ? String(b.billId) : null;
  if (kind === "fee_transfer") {
    if (!matterId) throw new UserError("Earned fees come from a matter: pick it");
    if (billId) {
      if (!uuidish(billId)) throw new UserError("Not found", 404);
      const [bill] = await q<{ matter_id: string; total_cents: string }>(`SELECT matter_id, total_cents FROM bills WHERE id = $1`, [billId]);
      if (!bill || bill.matter_id !== matterId) throw new UserError("That bill is for another matter");
      const [{ paid }] = await q<{ paid: string }>(`SELECT COALESCE(sum(amount_cents), 0) AS paid FROM trust_txns WHERE bill_id = $1 AND voided_at IS NULL`, [billId]);
      if (Number(paid) + amount > Number(bill.total_cents)) throw new UserError(`That's more than is left on the bill (${money(Number(bill.total_cents) - Number(paid))})`);
    }
  } else billId = null;
  const id = await tx(async (tq) => {
    const [acct] = await tq<{ archived: boolean }>(`SELECT archived FROM trust_accounts WHERE id = $1`, [accountId]);
    if (!acct) throw new UserError("That trust account isn't there", 404);
    if (acct.archived) throw new UserError("That trust account is closed");
    // One entry at a time per account, so two payments can't both spend the same balance.
    await tq(`SELECT pg_advisory_xact_lock(hashtext('law-trust:' || $1))`, [accountId]);
    if (kind !== "deposit") {
      const held = await heldBy(tq, accountId, clientId, matterId);
      if (held.client < amount) throw new UserError(`The client only has ${money(held.client)} in this account`, 409);
      if (matterId && held.matter < amount) throw new UserError(`This matter only has ${money(held.matter)} in trust`, 409);
    }
    const [row] = await tq<{ id: string }>(
      `INSERT INTO trust_txns (account_id, client_id, matter_id, kind, amount_cents, day, received_on, party, reference, memo, bill_id, entered_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [accountId, clientId, matterId, kind, amount, day, receivedOn, party, text(b.reference, 60), text(b.memo, 1000), billId, me.email],
    );
    if (matterId) {
      const what = kind === "deposit" ? "deposited to" : kind === "disbursement" ? `paid to ${party} from` : "moved as earned fees from";
      await logEvent(tq, matterId, "trust", `${money(amount)} ${what} trust`, me.email);
    }
    return row.id;
  });
  await syncBooks(id);
  return (await txn(id))!;
}

async function txn(id: string) {
  const [t] = await q<Txn>(`SELECT ${TXN_COLS} FROM ${TXN_FROM} WHERE x.id = $1`, [id]);
  return t ? { ...t, amountCents: Number(t.amount_cents), late: lateness(t) } : null;
}

/** Voids an entry, keeping it on the ledger. Voiding a deposit can't leave anyone below zero. */
export async function voidTxn(me: Me, id: string, b: Record<string, unknown>) {
  requireKeeper(me);
  if (!uuidish(id)) throw new UserError("Not found", 404);
  const reason = text(b.reason, 500);
  if (!reason) throw new UserError("Say why it's being voided");
  await tx(async (tq) => {
    const [t] = await tq<{ account_id: string; client_id: string; matter_id: string | null; kind: string; amount_cents: string; voided_at: Date | null }>(
      `SELECT account_id, client_id, matter_id, kind, amount_cents, voided_at FROM trust_txns WHERE id = $1`,
      [id],
    );
    if (!t) throw new UserError("Not found", 404);
    if (t.voided_at) throw new UserError("It's already void");
    await tq(`SELECT pg_advisory_xact_lock(hashtext('law-trust:' || $1))`, [t.account_id]);
    if (t.kind === "deposit") {
      const held = await heldBy(tq, t.account_id, t.client_id, t.matter_id);
      const amt = Number(t.amount_cents);
      if (held.client < amt || held.matter < amt) {
        throw new UserError("Some of this deposit has already been paid out, so voiding it would leave the client below zero. Void those payments first.", 409);
      }
    }
    await tq(`UPDATE trust_txns SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1`, [id, me.email, reason]);
    if (t.matter_id) await logEvent(tq, t.matter_id, "trust", `A ${t.kind.replace("_", " ")} of ${money(Number(t.amount_cents))} was voided: ${reason}`, me.email);
  });
  await syncBooks(id);
  return txn(id);
}

/**
 * Sends an entry (and its void) to Books if they haven't gone yet. A failure is kept on the entry
 * and can be retried; the trust ledger itself never depends on Books answering.
 */
export async function syncBooks(id: string): Promise<void> {
  if (!booksConfigured()) return;
  const t = await txn(id);
  if (!t) return;
  const label = [t.client_name, t.number, t.party, t.reference].filter(Boolean).join(" · ");
  if (t.books_status !== "posted") {
    try {
      await post({ reference: `law-trust:${t.id}`, date: t.day, description: `Trust ${t.kind.replace("_", " ")}: ${label}`, lines: trustLines(t.kind, Number(t.amount_cents), label) });
      await q(`UPDATE trust_txns SET books_status = 'posted', books_error = '' WHERE id = $1`, [id]);
    } catch (e) {
      await q(`UPDATE trust_txns SET books_status = 'failed', books_error = $2 WHERE id = $1`, [id, (e as Error).message.slice(0, 500)]);
      return;
    }
  }
  if (t.voided_at && t.void_books_status !== "posted") {
    try {
      await post({
        reference: `law-trust-void:${t.id}`,
        date: t.voided_at.toISOString().slice(0, 10),
        description: `Void trust ${t.kind.replace("_", " ")}: ${label}`,
        lines: trustLines(t.kind, Number(t.amount_cents), label, true),
      });
      await q(`UPDATE trust_txns SET void_books_status = 'posted', books_error = '' WHERE id = $1`, [id]);
    } catch (e) {
      await q(`UPDATE trust_txns SET void_books_status = 'failed', books_error = $2 WHERE id = $1`, [id, (e as Error).message.slice(0, 500)]);
    }
  }
}

export async function retryBooks(me: Me, id: string) {
  requireKeeper(me);
  if (!uuidish(id)) throw new UserError("Not found", 404);
  if (!booksConfigured()) throw new UserError("Books isn't connected", 400);
  await syncBooks(id);
  return txn(id);
}

/**
 * Three-way reconciliation as of a statement date: the bank's balance adjusted for checks not yet
 * cleared and deposits not yet credited, against the ledger and the sum of every client's balance.
 */
export async function reconcile(me: Me, accountId: string, b: Record<string, unknown>) {
  requireKeeper(me);
  if (!uuidish(accountId)) throw new UserError("Not found", 404);
  const statementDay = dayOrNull(b.statementDay, "Statement date");
  if (!statementDay) throw new UserError("Pick the statement date");
  const signed = (v: unknown, what: string) => {
    const s = String(v ?? "").trim();
    const neg = s.startsWith("-");
    const c = cents(neg ? s.slice(1) : s, what) ?? 0;
    return neg ? -c : c;
  };
  const statement = signed(b.statementBalance, "Statement balance");
  const outstanding = (cents(b.outstandingChecks, "Outstanding checks") ?? 0) - (cents(b.depositsInTransit, "Deposits in transit") ?? 0);
  const [r] = await q<{ book: string }>(
    `SELECT COALESCE(sum(CASE WHEN kind = 'deposit' THEN amount_cents ELSE -amount_cents END), 0) AS book
     FROM trust_txns WHERE account_id = $1 AND day <= $2 AND (voided_at IS NULL OR voided_at::date > $2)`,
    [accountId, statementDay],
  );
  const perClient = await q<{ cents: string }>(
    `SELECT sum(CASE WHEN kind = 'deposit' THEN amount_cents ELSE -amount_cents END) AS cents
     FROM trust_txns WHERE account_id = $1 AND day <= $2 AND (voided_at IS NULL OR voided_at::date > $2) GROUP BY client_id`,
    [accountId, statementDay],
  );
  const book = Number(r.book);
  const clients = perClient.reduce((a, c) => a + Number(c.cents), 0);
  const negative = perClient.filter((c) => Number(c.cents) < 0).length;
  const adjusted = statement - outstanding;
  const balanced = adjusted === book && book === clients && negative === 0;
  const [row] = await q<{ id: string }>(
    `INSERT INTO reconciliations (account_id, statement_day, statement_cents, outstanding_cents, book_cents, clients_cents, balanced, note, done_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [accountId, statementDay, statement, outstanding, book, clients, balanced, text(b.note, 2000), me.email],
  );
  return { id: row.id, statementDay, statementCents: statement, outstandingCents: outstanding, adjustedCents: adjusted, bookCents: book, clientsCents: clients, negativeClients: negative, balanced };
}

export async function reconciliations(me: Me, accountId: string) {
  if (!isTrustKeeper(me.email) && !isAdmin(me.email)) throw new UserError("Only the firm's trust account keepers see reconciliations", 403);
  if (!uuidish(accountId)) throw new UserError("Not found", 404);
  return q(
    `SELECT id, to_char(statement_day, 'YYYY-MM-DD') AS statement_day, statement_cents, outstanding_cents, book_cents, clients_cents, balanced, note, done_by, done_at
     FROM reconciliations WHERE account_id = $1 ORDER BY statement_day DESC, done_at DESC LIMIT 120`,
    [accountId],
  );
}
