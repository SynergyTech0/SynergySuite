import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Loader2, Plus, Target, TrendingUp, Wallet, X, Trash2 } from 'lucide-react';
import { PageHeader, StatGrid, StatCard, Card, StatusPill, TabBar } from '../components/ui';
import { formatMoney } from '../lib/format';
import { useAccounts } from '../hooks/useAccounts';
import {
  useBudgetAction,
  useBudgetForecast,
  useBudgetVariance,
  useBudgets,
  type Budget,
} from '../hooks/usePlanning';

const today = () => new Date().toISOString().slice(0, 10);
const money = (n: number) => <span className="tabular-nums">{formatMoney(n)}</span>;
/** Remounts the plan editor when the saved plan or status changes. */
const planKey = (b: Budget) => `${b.id}:${b.status}:${JSON.stringify(b.lineItems.map((l) => [l.accountId, l.periodAmounts]))}`;
const pct = (n: number | null) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);

function Tone({ value, favorable }: { value: number; favorable: boolean | null }) {
  return (
    <span
      className={clsx(
        'tabular-nums',
        favorable === true && value !== 0 && 'text-green-700',
        favorable === false && 'text-red-600',
      )}
    >
      {formatMoney(value)}
    </span>
  );
}

export function Budgets() {
  const { data, isLoading, isError, error } = useBudgets();
  const budgets = data ?? [];
  const [selectedId, setSelectedId] = useState<string>();
  const [tab, setTab] = useState('actual');
  const [showCreate, setShowCreate] = useState(false);
  const selected = budgets.find((b) => b.id === selectedId) ?? budgets[0];

  useEffect(() => {
    if (!selectedId && budgets[0]) setSelectedId(budgets[0].id);
  }, [budgets, selectedId]);

  return (
    <div>
      <PageHeader
        title="Budgets"
        subtitle="Plan by account and period, track actuals from the ledger, and forecast the year"
        actions={
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New budget
          </button>
        }
      />

      {isLoading ? (
        <Card>
          <div className="px-4 py-12 text-center text-sm text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
            Loading budgets…
          </div>
        </Card>
      ) : isError ? (
        <Card>
          <div className="px-4 py-12 text-center text-sm text-red-500">{(error as Error)?.message || 'Could not load budgets.'}</div>
        </Card>
      ) : !selected ? (
        <Card>
          <div className="px-4 py-12 text-center text-sm text-gray-500">
            No budgets yet. Start one from last year&apos;s actuals or from scratch.
          </div>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <select className="input max-w-xs" value={selected.id} onChange={(e) => setSelectedId(e.target.value)}>
              {budgets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.budgetName} · FY{b.fiscalYear}
                </option>
              ))}
            </select>
            <StatusPill status={selected.status} />
            <span className="text-sm text-gray-500">
              {selected.period.toLowerCase()} · {selected.startDate.slice(0, 10)} to {selected.endDate.slice(0, 10)}
            </span>
            <StatusActions budget={selected} onDeleted={() => setSelectedId(undefined)} />
          </div>

          <StatGrid>
            <StatCard label="Planned revenue" value={formatMoney(selected.totals.revenue)} icon={TrendingUp} tone="success" />
            <StatCard label="Planned expenses" value={formatMoney(selected.totals.expense)} icon={Wallet} tone="default" />
            <StatCard label="Planned net income" value={formatMoney(selected.totals.netIncome)} icon={Target} tone="accent" />
          </StatGrid>

          <Card>
            <div className="px-4">
              <TabBar
                tabs={[
                  { key: 'actual', label: 'Budget vs actual' },
                  { key: 'forecast', label: 'Forecast' },
                  { key: 'plan', label: 'Plan' },
                ]}
                active={tab}
                onChange={setTab}
              />
            </div>
            {tab === 'plan' && <PlanGrid key={planKey(selected)} budget={selected} />}
            {tab === 'actual' && <BudgetVsActual budget={selected} />}
            {tab === 'forecast' && <ForecastView budget={selected} />}
          </Card>
        </>
      )}

      {showCreate && (
        <CreateBudget
          onClose={() => setShowCreate(false)}
          onCreated={(b) => {
            setSelectedId(b.id);
            setTab('plan');
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

function StatusActions({ budget, onDeleted }: { budget: Budget; onDeleted: () => void }) {
  const act = useBudgetAction();
  const run = (path: string, method = 'POST') => act.mutate({ path: `/${budget.id}${path}`, method }, path === '' ? { onSuccess: onDeleted } : undefined);
  const s = budget.status;
  return (
    <div className="flex items-center gap-2 ml-auto">
      {s === 'DRAFT' && (
        <button className="btn-secondary" disabled={act.isPending} onClick={() => run('/approve')}>
          Approve
        </button>
      )}
      {s === 'APPROVED' && (
        <button className="btn-secondary" disabled={act.isPending} onClick={() => run('/activate')}>
          Make active
        </button>
      )}
      {s !== 'DRAFT' && (
        <button className="btn-secondary" disabled={act.isPending} onClick={() => run('/reopen')}>
          Reopen
        </button>
      )}
      {s !== 'CLOSED' && s !== 'DRAFT' && (
        <button className="btn-secondary" disabled={act.isPending} onClick={() => run('/close')}>
          Close
        </button>
      )}
      {s === 'DRAFT' && (
        <button
          className="btn-secondary"
          disabled={act.isPending}
          onClick={() => window.confirm(`Delete ${budget.budgetName}?`) && run('', 'DELETE')}
        >
          Delete
        </button>
      )}
      {act.isError && <span className="text-sm text-red-600">{(act.error as Error).message}</span>}
    </div>
  );
}

/** The plan, one row per account and one column per period. Editable while the budget is a draft. */
function PlanGrid({ budget }: { budget: Budget }) {
  const editable = budget.status === 'DRAFT';
  const { data: accounts } = useAccounts();
  const save = useBudgetAction();
  const [rows, setRows] = useState(() =>
    budget.lineItems.map((l) => ({ accountId: l.accountId, label: `${l.account.accountNumber} ${l.account.name}`, amounts: l.periodAmounts.map(String) })),
  );
  const [adding, setAdding] = useState('');
  const n = budget.periods.length;
  const dirty = useMemo(
    () => JSON.stringify(rows.map((r) => [r.accountId, r.amounts.map(Number)])) !==
      JSON.stringify(budget.lineItems.map((l) => [l.accountId, l.periodAmounts])),
    [rows, budget],
  );
  const available = (accounts ?? []).filter((a) => a.isActive !== false && !rows.some((r) => r.accountId === a.id));

  const setCell = (i: number, p: number, v: string) =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, amounts: r.amounts.map((x, q) => (q === p ? v : x)) } : r)));
  const fillRow = (i: number) => {
    const total = window.prompt('Annual amount to spread evenly across the periods');
    if (!total || Number.isNaN(Number(total))) return;
    const each = Math.trunc((Number(total) * 100) / n) / 100;
    const amounts = Array.from({ length: n }, (_, q) => (q === n - 1 ? (Number(total) - each * (n - 1)).toFixed(2) : each.toFixed(2)));
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, amounts } : r)));
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="px-4 py-2 font-medium sticky left-0 bg-white min-w-[14rem]">Account</th>
              {budget.periods.map((p) => (
                <th key={p.index} className="px-2 py-2 font-medium text-right whitespace-nowrap">{p.label}</th>
              ))}
              <th className="px-4 py-2 font-medium text-right">Total</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.accountId} className="border-b last:border-0">
                <td className="px-4 py-1.5 sticky left-0 bg-white">
                  {editable ? (
                    <button className="text-left hover:text-primary-600" title="Spread an annual amount" onClick={() => fillRow(i)}>
                      {r.label}
                    </button>
                  ) : (
                    r.label
                  )}
                </td>
                {r.amounts.map((v, p) => (
                  <td key={p} className="px-1 py-1 text-right">
                    {editable ? (
                      <input
                        className="w-24 px-2 py-1 text-right border border-gray-200 rounded tabular-nums"
                        type="number"
                        step="0.01"
                        value={v}
                        onChange={(e) => setCell(i, p, e.target.value)}
                      />
                    ) : (
                      money(Number(v))
                    )}
                  </td>
                ))}
                <td className="px-4 py-1.5 text-right font-medium">{money(r.amounts.reduce((s, x) => s + (Number(x) || 0), 0))}</td>
                {editable && (
                  <td className="pr-3">
                    <button className="p-1 text-gray-400 hover:text-red-600" aria-label="Remove line" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={n + 3} className="px-4 py-8 text-center text-gray-400">
                  No lines yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editable ? (
        <div className="flex flex-wrap items-center gap-2 p-4 border-t">
          <select className="input max-w-xs" value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Add an account…</option>
            {available.map((a) => (
              <option key={a.id} value={a.id}>
                {a.accountNumber} {a.name}
              </option>
            ))}
          </select>
          <button
            className="btn-secondary"
            disabled={!adding}
            onClick={() => {
              const a = available.find((x) => x.id === adding)!;
              setRows((rs) => [...rs, { accountId: a.id, label: `${a.accountNumber} ${a.name}`, amounts: Array(n).fill('0') }]);
              setAdding('');
            }}
          >
            Add line
          </button>
          <span className="text-xs text-gray-400">Click an account name to spread an annual amount.</span>
          <button
            className="btn-primary ml-auto"
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate({
                path: `/${budget.id}`,
                method: 'PUT',
                body: { lineItems: rows.map((r) => ({ accountId: r.accountId, periodAmounts: r.amounts.map((x) => Number(x) || 0) })) },
              })
            }
          >
            {save.isPending ? 'Saving…' : 'Save plan'}
          </button>
          {save.isError && <span className="text-sm text-red-600">{(save.error as Error).message}</span>}
        </div>
      ) : (
        <p className="p-4 border-t text-sm text-gray-500">Reopen the budget to change the plan.</p>
      )}
    </div>
  );
}

function BudgetVsActual({ budget }: { budget: Budget }) {
  const [asOf, setAsOf] = useState(today());
  const { data, isLoading, isError, error } = useBudgetVariance(budget.id, asOf);
  const [byPeriod, setByPeriod] = useState(false);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 p-4 border-b">
        <label className="text-sm text-gray-600">
          As of{' '}
          <input type="date" className="input inline-block w-auto ml-1" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <label className="text-sm text-gray-600 flex items-center gap-2">
          <input type="checkbox" checked={byPeriod} onChange={(e) => setByPeriod(e.target.checked)} />
          Show net income by period
        </label>
        <span className="text-xs text-gray-400 ml-auto">Actuals come from posted journal entries.</span>
      </div>
      {isLoading ? (
        <div className="px-4 py-12 text-center text-sm text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
          Comparing with the ledger…
        </div>
      ) : isError || !data ? (
        <div className="px-4 py-12 text-center text-sm text-red-500">{(error as Error)?.message}</div>
      ) : byPeriod ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="px-4 py-2 font-medium">Net income</th>
                {data.periods.map((p) => (
                  <th key={p.index} className={clsx('px-3 py-2 font-medium text-right whitespace-nowrap', !p.closed && 'text-gray-400')}>
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['budget', 'actual'] as const).map((k) => (
                <tr key={k} className="border-b">
                  <td className="px-4 py-2 capitalize">{k}</td>
                  {data.totals.netIncome[k].map((v, i) => (
                    <td key={i} className="px-3 py-2 text-right">{money(v)}</td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="px-4 py-2 font-medium">Variance</td>
                {data.totals.netIncome.actual.map((v, i) => {
                  const diff = v - data.totals.netIncome.budget[i];
                  return (
                    <td key={i} className="px-3 py-2 text-right font-medium">
                      <Tone value={diff} favorable={diff >= 0} />
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium text-right">Budget to date</th>
                <th className="px-4 py-2 font-medium text-right">Actual to date</th>
                <th className="px-4 py-2 font-medium text-right">Variance</th>
                <th className="px-4 py-2 font-medium text-right">%</th>
                <th className="px-4 py-2 font-medium text-right">Full-year budget</th>
                <th className="px-4 py-2 font-medium text-right">Saved forecast</th>
              </tr>
            </thead>
            <tbody>
              {data.lineItems.map((l) => (
                <tr key={l.accountId} className="border-b">
                  <td className="px-4 py-2">
                    <span className="font-mono text-gray-500 mr-2">{l.accountNumber}</span>
                    {l.accountName}
                  </td>
                  <td className="px-4 py-2 text-right">{money(l.ytdBudget)}</td>
                  <td className="px-4 py-2 text-right">{money(l.ytdActual)}</td>
                  <td className="px-4 py-2 text-right">
                    <Tone value={l.ytdVariance} favorable={l.favorable} />
                  </td>
                  <td className="px-4 py-2 text-right text-gray-500">{pct(l.ytdVariancePercent)}</td>
                  <td className="px-4 py-2 text-right">{money(l.budgetTotal)}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{budget.forecastMethod ? money(l.forecastTotal) : '—'}</td>
                </tr>
              ))}
              {(['revenue', 'expense', 'netIncome'] as const).map((k) => {
                const t = data.totals[k];
                const diff = t.ytdActual - t.ytdBudget;
                return (
                  <tr key={k} className="bg-gray-50 font-medium">
                    <td className="px-4 py-2">{k === 'netIncome' ? 'Net income' : k === 'revenue' ? 'Total revenue' : 'Total expenses'}</td>
                    <td className="px-4 py-2 text-right">{money(t.ytdBudget)}</td>
                    <td className="px-4 py-2 text-right">{money(t.ytdActual)}</td>
                    <td className="px-4 py-2 text-right">
                      <Tone value={diff} favorable={k === 'expense' ? diff <= 0 : diff >= 0} />
                    </td>
                    <td />
                    <td className="px-4 py-2 text-right">{money(t.budgetTotal)}</td>
                    <td />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const METHODS = [
  { key: 'RUN_RATE', label: 'Run rate', hint: 'Repeats the average closed period for the rest of the year.' },
  { key: 'TREND', label: 'Trend', hint: 'Extends the straight line through the closed periods.' },
  { key: 'BUDGET', label: 'Plan for the rest', hint: 'Keeps the budget for periods that have not closed.' },
];

function ForecastView({ budget }: { budget: Budget }) {
  const [method, setMethod] = useState(budget.forecastMethod || 'RUN_RATE');
  const [asOf, setAsOf] = useState(today());
  const { data, isLoading, isError, error } = useBudgetForecast(budget.id, method, asOf);
  const save = useBudgetAction();

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 p-4 border-b">
        <select className="input w-auto" value={method} onChange={(e) => setMethod(e.target.value)}>
          {METHODS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        <label className="text-sm text-gray-600">
          Actuals through{' '}
          <input type="date" className="input inline-block w-auto ml-1" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <span className="text-xs text-gray-400">{METHODS.find((m) => m.key === method)?.hint}</span>
        <button
          className="btn-primary ml-auto"
          disabled={save.isPending}
          onClick={() => save.mutate({ path: `/${budget.id}/forecast`, body: { method, asOf } })}
        >
          {save.isPending ? 'Saving…' : 'Save forecast'}
        </button>
      </div>
      {budget.forecastMethod && (
        <p className="px-4 pt-3 text-xs text-gray-500">
          Saved forecast: {METHODS.find((m) => m.key === budget.forecastMethod)?.label ?? budget.forecastMethod}, actuals through{' '}
          {budget.forecastAsOf?.slice(0, 10)}.
        </p>
      )}
      {isLoading ? (
        <div className="px-4 py-12 text-center text-sm text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
          Forecasting…
        </div>
      ) : isError || !data ? (
        <div className="px-4 py-12 text-center text-sm text-red-500">{(error as Error)?.message}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium text-right">Budget</th>
                <th className="px-4 py-2 font-medium text-right">Forecast</th>
                <th className="px-4 py-2 font-medium text-right">Variance</th>
                <th className="px-4 py-2 font-medium text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {data.lineItems.map((l) => (
                <tr key={l.accountId} className="border-b">
                  <td className="px-4 py-2">
                    <span className="font-mono text-gray-500 mr-2">{l.accountNumber}</span>
                    {l.accountName}
                  </td>
                  <td className="px-4 py-2 text-right">{money(l.budgetTotal)}</td>
                  <td className="px-4 py-2 text-right">{money(l.forecastTotal)}</td>
                  <td className="px-4 py-2 text-right">
                    <Tone value={l.variance} favorable={l.favorable} />
                  </td>
                  <td className="px-4 py-2 text-right text-gray-500">{pct(l.variancePercent)}</td>
                </tr>
              ))}
              {(['revenue', 'expense', 'netIncome'] as const).map((k) => {
                const t = data.totals[k];
                const diff = t.forecast - t.budget;
                return (
                  <tr key={k} className="bg-gray-50 font-medium">
                    <td className="px-4 py-2">{k === 'netIncome' ? 'Net income' : k === 'revenue' ? 'Total revenue' : 'Total expenses'}</td>
                    <td className="px-4 py-2 text-right">{money(t.budget)}</td>
                    <td className="px-4 py-2 text-right">{money(t.forecast)}</td>
                    <td className="px-4 py-2 text-right">
                      <Tone value={diff} favorable={k === 'expense' ? diff <= 0 : diff >= 0} />
                    </td>
                    <td />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {save.isError && <p className="p-4 text-sm text-red-600">{(save.error as Error).message}</p>}
    </div>
  );
}

function CreateBudget({ onClose, onCreated }: { onClose: () => void; onCreated: (b: Budget) => void }) {
  const year = new Date().getFullYear();
  const [form, setForm] = useState({ name: `${year + 1} plan`, fiscalYear: String(year + 1), period: 'MONTHLY', seed: 'actuals', growth: '5' });
  const create = useBudgetAction<Budget>();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const base = { budgetName: form.name, fiscalYear: Number(form.fiscalYear), period: form.period };
    create.mutate(
      form.seed === 'actuals'
        ? { path: '/from-actuals', body: { ...base, growthPercent: Number(form.growth) || 0 } }
        : { path: '', body: { ...base, lineItems: [] } },
      { onSuccess: onCreated },
    );
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">New budget</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 rounded" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Fiscal year</label>
              <input type="number" className="input" value={form.fiscalYear} onChange={(e) => setForm({ ...form, fiscalYear: e.target.value })} required />
            </div>
            <div>
              <label className="label">Periods</label>
              <select className="input" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="ANNUAL">Annual</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={form.seed === 'actuals'} onChange={() => setForm({ ...form, seed: 'actuals' })} />
              Start from last year&apos;s actuals
            </label>
            {form.seed === 'actuals' && (
              <div className="pl-6">
                <label className="label">Change every line by (%)</label>
                <input type="number" step="0.1" className="input" value={form.growth} onChange={(e) => setForm({ ...form, growth: e.target.value })} />
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={form.seed === 'blank'} onChange={() => setForm({ ...form, seed: 'blank' })} />
              Start blank
            </label>
          </div>
          {create.isError && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        </div>
        <div className="p-4 border-t bg-gray-50 rounded-b-xl flex gap-2">
          <button type="submit" disabled={create.isPending || !form.name} className="flex-1 btn-primary">
            {create.isPending ? 'Creating…' : 'Create budget'}
          </button>
          <button type="button" onClick={onClose} className="flex-1 btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
