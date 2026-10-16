import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Loader2, Plus, X } from 'lucide-react';
import { PageHeader, Card, StatusPill, TabBar } from '../components/ui';
import { formatAmount } from '../lib/format';
import { useAuth } from '../stores/authStore';
import {
  useCompanies,
  useCompanyAccounts,
  useConsolidatedReport,
  useConsolidationAction,
  useCreateCompany,
  useGroups,
  useIntercompany,
  useMemberMutations,
  useMembers,
  useRates,
  type Cols,
  type ConsLine,
  type ConsolidatedReport,
  type Group,
} from '../hooks/usePlanning';

const today = () => new Date().toISOString().slice(0, 10);
const yearStart = () => `${new Date().getFullYear()}-01-01`;

export function Consolidation() {
  const [tab, setTab] = useState('report');
  return (
    <div>
      <PageHeader title="Consolidation" subtitle="Report your companies as one group, with intercompany activity eliminated" />
      <Card>
        <div className="px-4">
          <TabBar
            tabs={[
              { key: 'report', label: 'Group report' },
              { key: 'intercompany', label: 'Intercompany' },
              { key: 'rates', label: 'Exchange rates' },
              { key: 'companies', label: 'Companies' },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>
        {tab === 'report' && <GroupReport />}
        {tab === 'intercompany' && <Intercompany />}
        {tab === 'rates' && <Rates />}
        {tab === 'companies' && <Companies />}
      </Card>
    </div>
  );
}

// ---- Group report --------------------------------------------------------------

function GroupReport() {
  const { data: groups, isLoading } = useGroups();
  const [groupId, setGroupId] = useState<string>();
  const [start, setStart] = useState(yearStart());
  const [end, setEnd] = useState(today());
  const [view, setView] = useState<'pl' | 'bs'>('pl');
  const [editing, setEditing] = useState<Group | 'new' | null>(null);
  const group = groups?.find((g) => g.id === groupId) ?? groups?.[0];
  const report = useConsolidatedReport(group?.id, start, end);

  useEffect(() => {
    if (!groupId && groups?.[0]) setGroupId(groups[0].id);
  }, [groups, groupId]);

  if (isLoading) return <Loading text="Loading groups…" />;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 p-4 border-b">
        {group ? (
          <select className="input max-w-xs" value={group.id} onChange={(e) => setGroupId(e.target.value)}>
            {groups!.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.reportingCurrency})
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-gray-500">No groups yet. A group reports two or more of your companies together.</span>
        )}
        {group && (
          <button className="btn-secondary" onClick={() => setEditing(group)}>
            Edit group
          </button>
        )}
        <button className="btn-secondary" onClick={() => setEditing('new')}>
          <Plus className="w-4 h-4 mr-1" />
          New group
        </button>
        {group && (
          <>
            <label className="text-sm text-gray-600 ml-auto">
              From <input type="date" className="input inline-block w-auto" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="text-sm text-gray-600">
              to <input type="date" className="input inline-block w-auto" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </>
        )}
      </div>
      {group &&
        (report.isLoading ? (
          <Loading text="Consolidating…" />
        ) : report.isError || !report.data ? (
          <p className="px-4 py-12 text-center text-sm text-red-500">{(report.error as Error)?.message}</p>
        ) : (
          <>
            <div className="flex items-center gap-2 px-4 pt-3">
              <button className={clsx('px-3 py-1 rounded-lg text-sm', view === 'pl' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:bg-gray-100')} onClick={() => setView('pl')}>
                Income statement
              </button>
              <button className={clsx('px-3 py-1 rounded-lg text-sm', view === 'bs' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:bg-gray-100')} onClick={() => setView('bs')}>
                Balance sheet
              </button>
              <span className="ml-auto text-xs text-gray-400">
                {report.data.companies
                  .filter((c) => c.currency !== report.data!.reportingCurrency)
                  .map((c) => `${c.name}: ${c.currency} at ${c.closingRate.toFixed(4)} closing, ${c.averageRate.toFixed(4)} average`)
                  .join(' · ')}
              </span>
            </div>
            {report.data.warnings.length > 0 && (
              <div className="mx-4 mt-3 p-3 rounded-lg bg-amber-50 text-amber-800 text-sm space-y-1">
                {report.data.warnings.map((w) => (
                  <p key={w} className="flex gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    {w}
                  </p>
                ))}
              </div>
            )}
            {view === 'pl' ? <IncomeStatement r={report.data} /> : <BalanceSheet r={report.data} />}
          </>
        ))}
      {editing && <GroupEditor group={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(g) => { setGroupId(g.id); setEditing(null); }} />}
    </div>
  );
}

function StatementTable({ r, children }: { r: ConsolidatedReport; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            <th className="px-4 py-2 font-medium">Account</th>
            {r.companies.map((c) => (
              <th key={c.id} className="px-4 py-2 font-medium text-right whitespace-nowrap">{c.name}</th>
            ))}
            <th className="px-4 py-2 font-medium text-right">Eliminations</th>
            <th className="px-4 py-2 font-medium text-right">Group ({r.reportingCurrency})</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Row({ label, c, cur, strong, muted }: { label: React.ReactNode; c: Cols; cur: string; strong?: boolean; muted?: boolean }) {
  const f = (n: number) => (n === 0 ? <span className="text-gray-300">—</span> : formatAmount(n, cur));
  return (
    <tr className={clsx('border-b', strong && 'bg-gray-50 font-medium', muted && 'text-gray-500')}>
      <td className="px-4 py-1.5">{label}</td>
      {c.byCompany.map((v, i) => (
        <td key={i} className="px-4 py-1.5 text-right tabular-nums">{f(v)}</td>
      ))}
      <td className="px-4 py-1.5 text-right tabular-nums text-amber-700">{f(c.eliminations)}</td>
      <td className="px-4 py-1.5 text-right tabular-nums font-medium">{f(c.consolidated)}</td>
    </tr>
  );
}

const lineLabel = (l: ConsLine) => (
  <>
    <span className="font-mono text-gray-400 mr-2">{l.accountNumber}</span>
    {l.name}
  </>
);

function Heading({ text, span }: { text: string; span: number }) {
  return (
    <tr>
      <td colSpan={span} className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
        {text}
      </td>
    </tr>
  );
}

function IncomeStatement({ r }: { r: ConsolidatedReport }) {
  const cur = r.reportingCurrency;
  const span = r.companies.length + 3;
  const is = r.incomeStatement;
  return (
    <StatementTable r={r}>
      <Heading text="Revenue" span={span} />
      {is.revenue.map((l) => <Row key={l.accountNumber} label={lineLabel(l)} c={l} cur={cur} />)}
      <Row label="Total revenue" c={is.totals.revenue} cur={cur} strong />
      <Heading text="Expenses" span={span} />
      {is.expenses.map((l) => <Row key={l.accountNumber} label={lineLabel(l)} c={l} cur={cur} />)}
      <Row label="Total expenses" c={is.totals.expenses} cur={cur} strong />
      <Row label="Net income" c={is.totals.netIncome} cur={cur} strong />
    </StatementTable>
  );
}

function BalanceSheet({ r }: { r: ConsolidatedReport }) {
  const cur = r.reportingCurrency;
  const span = r.companies.length + 3;
  const bs = r.balanceSheet;
  return (
    <>
      <StatementTable r={r}>
        <Heading text="Assets" span={span} />
        {bs.assets.map((l) => <Row key={l.accountNumber} label={lineLabel(l)} c={l} cur={cur} />)}
        <Row label="Total assets" c={bs.totals.assets} cur={cur} strong />
        <Heading text="Liabilities" span={span} />
        {bs.liabilities.map((l) => <Row key={l.accountNumber} label={lineLabel(l)} c={l} cur={cur} />)}
        <Row label="Total liabilities" c={bs.totals.liabilities} cur={cur} strong />
        <Heading text="Equity" span={span} />
        {bs.equity.map((l) => <Row key={l.accountNumber} label={lineLabel(l)} c={l} cur={cur} />)}
        <Row label="Earnings to date" c={bs.earnings} cur={cur} />
        <Row label="Currency translation adjustment" c={bs.translationAdjustment} cur={cur} muted />
        <Row label="Intercompany difference" c={bs.eliminationDifference} cur={cur} muted />
        <Row label="Total equity" c={bs.totals.equity} cur={cur} strong />
        <Row label="Liabilities and equity" c={bs.totals.liabilitiesAndEquity} cur={cur} strong />
      </StatementTable>
      <p className={clsx('px-4 py-3 text-sm', bs.totals.isBalanced ? 'text-green-700' : 'text-red-600')}>
        {bs.totals.isBalanced ? 'The group balance sheet balances.' : 'The group balance sheet does not balance.'}
      </p>
      {r.intercompany.length > 0 && (
        <div className="px-4 pb-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Intercompany balances</p>
          <table className="text-sm">
            <tbody>
              {r.intercompany.map((p) => (
                <tr key={p.from + p.to}>
                  <td className="pr-4 py-1">{p.fromName} is owed by {p.toName}</td>
                  <td className="pr-4 py-1 text-right tabular-nums">{formatAmount(p.receivable, cur)}</td>
                  <td className="pr-4 py-1 text-gray-500">they show {formatAmount(p.payable, cur)}</td>
                  <td className={clsx('py-1', Math.abs(p.difference) < 0.01 ? 'text-green-700' : 'text-amber-700')}>
                    {Math.abs(p.difference) < 0.01 ? 'matched' : `off by ${formatAmount(p.difference, cur)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function GroupEditor({ group, onClose, onSaved }: { group: Group | null; onClose: () => void; onSaved: (g: Group) => void }) {
  const { data: companies } = useCompanies();
  const me = useAuth((s) => s.user?.organizationId);
  const [name, setName] = useState(group?.name ?? 'Group');
  const [currency, setCurrency] = useState(group?.reportingCurrency ?? 'USD');
  const [parent, setParent] = useState(group?.parentOrganizationId ?? me ?? '');
  const [ids, setIds] = useState<string[]>(group?.companies.map((c) => c.id) ?? (me ? [me] : []));
  const save = useConsolidationAction<Group>();
  const del = useConsolidationAction();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = { name, reportingCurrency: currency, parentOrganizationId: parent, organizationIds: ids };
    save.mutate(group ? { path: `/groups/${group.id}`, method: 'PUT', body } : { path: '/groups', body }, { onSuccess: onSaved });
  };
  return (
    <Modal title={group ? 'Edit group' : 'New group'} onClose={onClose} onSubmit={submit} busy={save.isPending} submitLabel="Save group" error={(save.error || del.error) as Error | null}>
      <div>
        <label className="label">Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <label className="label">Report in</label>
        <input className="input uppercase" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} required />
      </div>
      <div>
        <label className="label">Companies</label>
        <div className="space-y-1">
          {(companies ?? []).map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={ids.includes(c.id)}
                  onChange={(e) => setIds((xs) => (e.target.checked ? [...xs, c.id] : xs.filter((x) => x !== c.id)))}
                />
                {c.name} <span className="text-gray-400">{c.currency}</span>
              </label>
              <label className="ml-auto flex items-center gap-1 text-xs text-gray-500">
                <input type="radio" name="parent" checked={parent === c.id} onChange={() => { setParent(c.id); setIds((xs) => (xs.includes(c.id) ? xs : [...xs, c.id])); }} />
                parent
              </label>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-1">The parent&apos;s chart of accounts names the group&apos;s lines.</p>
      </div>
      {group && (
        <button
          type="button"
          className="text-sm text-red-600 hover:underline"
          onClick={() => window.confirm(`Delete ${group.name}? Entries stay in each company.`) && del.mutate({ path: `/groups/${group.id}`, method: 'DELETE' }, { onSuccess: onClose })}
        >
          Delete group
        </button>
      )}
    </Modal>
  );
}

// ---- Intercompany --------------------------------------------------------------

const KINDS = [
  { key: 'CHARGE', label: 'Charge', from: 'Income account', to: 'Expense or asset account', hint: 'One company bills another, such as a management fee. Eliminated in full.' },
  { key: 'LOAN', label: 'Loan or funding', from: 'Bank account it pays from', to: 'Bank account it lands in', hint: 'One company sends money to another. The balances are eliminated; the cash stays.' },
  { key: 'SETTLEMENT', label: 'Settlement', from: 'Bank account it lands in', to: 'Bank account it pays from', hint: 'The company that owes pays the balance down.' },
];

function Intercompany() {
  const { data, isLoading } = useIntercompany();
  const [open, setOpen] = useState(false);
  const act = useConsolidationAction();
  return (
    <div>
      <div className="flex items-center p-4 border-b">
        <p className="text-sm text-gray-500">Each entry posts a journal in both companies, tagged so the group report can eliminate it.</p>
        <button className="btn-primary ml-auto" onClick={() => setOpen(true)}>
          <Plus className="w-4 h-4 mr-1" />
          New entry
        </button>
      </div>
      {isLoading ? (
        <Loading text="Loading entries…" />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Kind</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 font-medium">Owed to</th>
                <th className="px-4 py-2 font-medium">Owed by</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((r) => (
                <tr key={r.id} className={clsx('border-b', r.voided && 'text-gray-400')}>
                  <td className="px-4 py-2 whitespace-nowrap">{r.date}</td>
                  <td className="px-4 py-2">{KINDS.find((k) => k.key === r.kind)?.label ?? r.kind}</td>
                  <td className="px-4 py-2">{r.description}</td>
                  <td className="px-4 py-2">
                    {r.from.name} <span className="tabular-nums">{formatAmount(r.from.amount, r.from.currency)}</span>
                    <span className="block text-xs text-gray-400">{r.from.journal?.journalNumber}</span>
                  </td>
                  <td className="px-4 py-2">
                    {r.to.name} <span className="tabular-nums">{formatAmount(r.to.amount, r.to.currency)}</span>
                    <span className="block text-xs text-gray-400">{r.to.journal?.journalNumber}</span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {r.voided ? (
                      <StatusPill status="VOIDED" />
                    ) : (
                      <button
                        className="text-sm text-red-600 hover:underline"
                        disabled={act.isPending}
                        onClick={() => window.confirm('Void the journal in both companies?') && act.mutate({ path: `/intercompany/${r.id}/void` })}
                      >
                        Void
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!data?.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                    No intercompany entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {act.isError && <p className="p-4 text-sm text-red-600">{(act.error as Error).message}</p>}
        </div>
      )}
      {open && <IntercompanyForm onClose={() => setOpen(false)} />}
    </div>
  );
}

function IntercompanyForm({ onClose }: { onClose: () => void }) {
  const { data: companies } = useCompanies();
  const me = useAuth((s) => s.user?.organizationId);
  const [f, setF] = useState({ kind: 'CHARGE', date: today(), description: '', from: me ?? '', to: '', fromAccount: '', toAccount: '', amount: '', toAmount: '' });
  const fromAccounts = useCompanyAccounts(f.from || undefined);
  const toAccounts = useCompanyAccounts(f.to || undefined);
  const save = useConsolidationAction();
  const kind = KINDS.find((k) => k.key === f.kind)!;
  const fromCo = companies?.find((c) => c.id === f.from);
  const toCo = companies?.find((c) => c.id === f.to);
  const pick = (list: typeof fromAccounts.data, side: 'from' | 'to') =>
    (list ?? []).filter((a) => {
      if (['1450', '2450'].includes(a.accountNumber)) return false;
      if (f.kind === 'CHARGE') return side === 'from' ? a.accountType === 'REVENUE' : a.accountType === 'EXPENSE' || a.accountType === 'ASSET';
      return a.accountType === 'ASSET';
    });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(
      {
        path: '/intercompany',
        body: {
          kind: f.kind,
          date: f.date,
          description: f.description,
          fromOrganizationId: f.from,
          toOrganizationId: f.to,
          fromAccountId: f.fromAccount,
          toAccountId: f.toAccount,
          amount: Number(f.amount),
          ...(f.toAmount && { toAmount: Number(f.toAmount) }),
        },
      },
      { onSuccess: onClose },
    );
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="New intercompany entry" onClose={onClose} onSubmit={submit} busy={save.isPending} submitLabel="Post in both companies" error={save.error as Error | null}>
      <div>
        <label className="label">Kind</label>
        <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, fromAccount: '', toAccount: '' })}>
          {KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-400 mt-1">{kind.hint}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Date</label>
          <input type="date" className="input" value={f.date} onChange={set('date')} required />
        </div>
        <div>
          <label className="label">Description</label>
          <input className="input" value={f.description} onChange={set('description')} required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="label">Owed to</label>
          <select className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, fromAccount: '' })} required>
            <option value="">Company…</option>
            {companies?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select className="input" value={f.fromAccount} onChange={set('fromAccount')} required>
            <option value="">{kind.from}…</option>
            {pick(fromAccounts.data, 'from').map((a) => (
              <option key={a.id} value={a.id}>
                {a.accountNumber} {a.name}
              </option>
            ))}
          </select>
          <input type="number" step="0.01" min="0.01" className="input" placeholder={`Amount${fromCo ? ` in ${fromCo.currency}` : ''}`} value={f.amount} onChange={set('amount')} required />
        </div>
        <div className="space-y-2">
          <label className="label">Owed by</label>
          <select className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value, toAccount: '' })} required>
            <option value="">Company…</option>
            {companies?.filter((c) => c.id !== f.from).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select className="input" value={f.toAccount} onChange={set('toAccount')} required>
            <option value="">{kind.to}…</option>
            {pick(toAccounts.data, 'to').map((a) => (
              <option key={a.id} value={a.id}>
                {a.accountNumber} {a.name}
              </option>
            ))}
          </select>
          {fromCo && toCo && fromCo.currency !== toCo.currency && (
            <input type="number" step="0.01" min="0.01" className="input" placeholder={`Amount in ${toCo.currency} (blank uses the day's rate)`} value={f.toAmount} onChange={set('toAmount')} />
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---- Exchange rates ------------------------------------------------------------

function Rates() {
  const { data, isLoading } = useRates();
  const save = useConsolidationAction();
  const [f, setF] = useState({ fromCurrency: 'EUR', toCurrency: 'USD', rate: '', effectiveDate: today() });
  return (
    <div>
      <form
        className="flex flex-wrap items-end gap-2 p-4 border-b"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ path: '/rates', body: { ...f, rate: Number(f.rate) } }, { onSuccess: () => setF({ ...f, rate: '' }) });
        }}
      >
        <div>
          <label className="label">1 unit of</label>
          <input className="input w-20 uppercase" maxLength={3} value={f.fromCurrency} onChange={(e) => setF({ ...f, fromCurrency: e.target.value.toUpperCase() })} required />
        </div>
        <div>
          <label className="label">buys</label>
          <input type="number" step="0.00000001" min="0" className="input w-32" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} required />
        </div>
        <div>
          <label className="label">of</label>
          <input className="input w-20 uppercase" maxLength={3} value={f.toCurrency} onChange={(e) => setF({ ...f, toCurrency: e.target.value.toUpperCase() })} required />
        </div>
        <div>
          <label className="label">on</label>
          <input type="date" className="input" value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} required />
        </div>
        <button className="btn-primary" disabled={save.isPending}>
          Save rate
        </button>
        {save.isError && <span className="text-sm text-red-600">{(save.error as Error).message}</span>}
      </form>
      <p className="px-4 pt-3 text-xs text-gray-400">
        Group reports use the latest rate on or before the end date for the balance sheet, and the average of the rates within the period for income and expenses.
      </p>
      {isLoading ? (
        <Loading text="Loading rates…" />
      ) : (
        <table className="min-w-full text-sm mt-2">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Pair</th>
              <th className="px-4 py-2 font-medium text-right">Rate</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.id} className="border-b">
                <td className="px-4 py-2">{r.effectiveDate}</td>
                <td className="px-4 py-2">
                  {r.fromCurrency} → {r.toCurrency}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{r.rate}</td>
              </tr>
            ))}
            {!data?.length && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-gray-400">
                  No rates yet. Companies in the reporting currency don&apos;t need any.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---- Companies -----------------------------------------------------------------

function Companies() {
  const { data: companies, isLoading } = useCompanies();
  const role = useAuth((s) => s.user?.role);
  const create = useCreateCompany();
  const [f, setF] = useState({ name: '', defaultCurrency: 'USD', fiscalYearEnd: '12' });
  const [selected, setSelected] = useState<string>();
  const company = companies?.find((c) => c.id === selected) ?? companies?.[0];

  if (isLoading) return <Loading text="Loading companies…" />;
  return (
    <div className="grid md:grid-cols-2 gap-0 md:divide-x">
      <div>
        <ul className="divide-y">
          {(companies ?? []).map((c) => (
            <li key={c.id}>
              <button className={clsx('w-full flex items-center gap-2 px-4 py-3 text-left text-sm hover:bg-gray-50', company?.id === c.id && 'bg-primary-50')} onClick={() => setSelected(c.id)}>
                <span className="font-medium">{c.name}</span>
                <span className="text-gray-400">{c.currency}</span>
                {c.current && <span className="text-xs text-primary-600">working here</span>}
                <span className="ml-auto text-xs text-gray-500">{c.role.toLowerCase()}</span>
              </button>
            </li>
          ))}
        </ul>
        {role === 'ADMIN' && (
          <form
            className="p-4 border-t space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(
                { name: f.name, defaultCurrency: f.defaultCurrency, fiscalYearEnd: Number(f.fiscalYearEnd) },
                { onSuccess: (c) => { setSelected(c.id); setF({ ...f, name: '' }); } },
              );
            }}
          >
            <p className="text-sm font-medium">Add a company</p>
            <div className="flex flex-wrap gap-2">
              <input className="input flex-1 min-w-[10rem]" placeholder="Company name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
              <input className="input w-20 uppercase" maxLength={3} value={f.defaultCurrency} onChange={(e) => setF({ ...f, defaultCurrency: e.target.value.toUpperCase() })} title="Currency" required />
              <select className="input w-auto" value={f.fiscalYearEnd} onChange={(e) => setF({ ...f, fiscalYearEnd: e.target.value })} title="Fiscal year ends">
                {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => (
                  <option key={m} value={i + 1}>
                    Year ends {m}
                  </option>
                ))}
              </select>
              <button className="btn-primary" disabled={create.isPending}>
                Add
              </button>
            </div>
            <p className="text-xs text-gray-400">It starts with the standard chart of accounts. Switch to it from the company menu at the top.</p>
            {create.isError && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
          </form>
        )}
      </div>
      {company && <MembersPanel companyId={company.id} canManage={company.role === 'ADMIN'} />}
    </div>
  );
}

function MembersPanel({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const { data, isLoading } = useMembers(companyId);
  const { add, remove } = useMemberMutations(companyId);
  const [f, setF] = useState({ email: '', role: 'USER' });
  return (
    <div className="p-4">
      <p className="text-sm font-medium mb-2">People with access</p>
      {isLoading ? (
        <Loading text="Loading people…" />
      ) : (
        <ul className="divide-y text-sm">
          {(data ?? []).map((m) => (
            <li key={m.userId} className="flex items-center gap-2 py-2">
              <span>{m.name || m.email}</span>
              <span className="text-gray-400">{m.email}</span>
              <span className="ml-auto text-xs text-gray-500">{m.role.toLowerCase()}</span>
              {canManage && (
                <button className="text-xs text-red-600 hover:underline" onClick={() => remove.mutate(m.userId)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form
          className="flex flex-wrap gap-2 mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate(f, { onSuccess: () => setF({ ...f, email: '' }) });
          }}
        >
          <input type="email" className="input flex-1 min-w-[12rem]" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
          <select className="input w-auto" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="USER">User</option>
            <option value="ACCOUNTANT">Accountant</option>
            <option value="MANAGER">Manager</option>
            <option value="ADMIN">Admin</option>
          </select>
          <button className="btn-secondary" disabled={add.isPending}>
            Give access
          </button>
        </form>
      )}
      {(add.isError || remove.isError) && <p className="text-sm text-red-600 mt-2">{((add.error || remove.error) as Error).message}</p>}
    </div>
  );
}

// ---- Shared --------------------------------------------------------------------

function Loading({ text }: { text: string }) {
  return (
    <div className="px-4 py-12 text-center text-sm text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
      {text}
    </div>
  );
}

function Modal({
  title,
  onClose,
  onSubmit,
  busy,
  submitLabel,
  error,
  children,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  busy: boolean;
  submitLabel: string;
  error: Error | null;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <form onSubmit={onSubmit} className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 rounded" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          {children}
          {error && <p className="text-sm text-red-600">{error.message}</p>}
        </div>
        <div className="p-4 border-t bg-gray-50 rounded-b-xl flex gap-2">
          <button type="submit" disabled={busy} className="flex-1 btn-primary">
            {busy ? 'Saving…' : submitLabel}
          </button>
          <button type="button" onClick={onClose} className="flex-1 btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
