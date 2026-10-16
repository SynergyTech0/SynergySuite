import { useState } from 'react';
import { RefreshCw, Sparkles, Check, Ban, Loader2 } from 'lucide-react';
import { PageHeader, Card, TabBar } from '../components/ui';
import type { Tab } from '../components/ui';
import { formatMoney, formatDate } from '../lib/format';
import { useOrgList, num } from '../hooks/useOrgList';
import { useAccounts } from '../hooks/useAccounts';
import { useBankTxnActions } from '../hooks/useBankFeed';
import type { BankTxn } from '../hooks/useBankFeed';
import { useBankAccounts, useUpdateBankFeed } from '../hooks/useBankAccounts';

type TabKey = 'review' | 'categorized' | 'excluded';

export function BankFeedReview() {
  const [tab, setTab] = useState<TabKey>('review');
  const review = useOrgList<BankTxn>('bank-transactions', { status: 'UNMATCHED' });
  const excluded = useOrgList<BankTxn>('bank-transactions', { status: 'EXCLUDED' });
  const all = useOrgList<BankTxn>('bank-transactions'); // categorized = everything actioned into the books
  const accountsQ = useAccounts();
  const bankAccountsQ = useBankAccounts();
  const updateFeed = useUpdateBankFeed();
  const { categorize, exclude } = useBankTxnActions();

  // "Categorized" = anything that's left the review queue and isn't excluded
  // (categorize sets CLEARED, matching sets MATCHED/RECONCILED, etc.).
  const categorizedRows = (all.data?.items ?? []).filter((t) => !['UNMATCHED', 'EXCLUDED'].includes(t.status));
  const categorizedCount = (all.data?.total ?? 0) - (review.data?.total ?? 0) - (excluded.data?.total ?? 0);

  const categoryAccounts = (accountsQ.data ?? []).filter(
    (a) => ['EXPENSE', 'REVENUE'].includes(a.accountType) && a.isActive !== false,
  );
  const defaultAccountId = categoryAccounts[0]?.id ?? '';
  const [picks, setPicks] = useState<Record<string, string>>({});
  const pickFor = (id: string) => picks[id] ?? defaultAccountId;
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const pendingId = categorize.isPending ? (categorize.variables as { id: string } | undefined)?.id : undefined;

  const addRow = (id: string) => {
    categorize.mutate(
      { id, accountId: pickFor(id) },
      { onSuccess: () => setAdded((a) => ({ ...a, [id]: true })) },
    );
  };

  const activeLoading = tab === 'review' ? review.isLoading : tab === 'excluded' ? excluded.isLoading : all.isLoading;
  const rows = tab === 'review' ? review.data?.items ?? [] : tab === 'excluded' ? excluded.data?.items ?? [] : categorizedRows;

  const tabs: Tab[] = [
    { key: 'review', label: 'For review', count: review.data?.total },
    { key: 'categorized', label: 'Categorized', count: categorizedCount },
    { key: 'excluded', label: 'Excluded', count: excluded.data?.total },
  ];

  return (
    <div>
      <PageHeader
        title="Bank feed"
        subtitle="Review and categorize downloaded transactions"
        actions={
          <button className="btn-secondary" onClick={() => updateFeed.mutate()} disabled={updateFeed.isPending}>
            {updateFeed.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            {updateFeed.isPending ? 'Updating…' : 'Update'}
          </button>
        }
      />

      {updateFeed.data && (
        <div className="mb-4 text-sm text-gray-700 bg-primary-50 border border-primary-100 rounded-lg px-4 py-2">
          Synced {updateFeed.data.linked} account{updateFeed.data.linked === 1 ? '' : 's'} · {updateFeed.data.imported} new
          transaction{updateFeed.data.imported === 1 ? '' : 's'} · {updateFeed.data.categorized + updateFeed.data.aiCategorized} auto-categorized
          {updateFeed.data.remaining > 0 && ` · ${updateFeed.data.remaining} need review`}.
        </div>
      )}
      {updateFeed.isError && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2">
          {(updateFeed.error as Error)?.message || 'Update failed.'}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {(bankAccountsQ.data ?? []).filter((a) => a.plaidItemId).length === 0 ? (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl p-4 sm:col-span-1">
            <p className="text-sm font-semibold text-gray-900">No linked bank</p>
            <p className="text-xs text-gray-500 mt-1">Connect an account on the Banking page to pull a live balance.</p>
          </div>
        ) : (
          (bankAccountsQ.data ?? [])
            .filter((a) => a.plaidItemId)
            .slice(0, 2)
            .map((a) => (
              <div key={a.id} className="bg-white border-2 border-primary-500 rounded-xl p-4">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {a.accountName} ••{(a.accountNumber || '').slice(-4)}
                </p>
                <p className="text-2xl font-bold tabular-nums mt-1">{formatMoney(num(a.currentBalance))}</p>
                <p className="text-xs text-gray-500 mt-1">Bank balance</p>
              </div>
            ))
        )}
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent-50 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-accent-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{review.data?.total ?? 0} to review</p>
            <p className="text-xs text-gray-500">Categorize each into a chart-of-accounts account, then add it to the books.</p>
          </div>
        </div>
      </div>

      <Card>
        <div className="px-4 pt-2">
          <TabBar tabs={tabs} active={tab} onChange={(k) => setTab(k as TabKey)} />
        </div>

        {activeLoading ? (
          <div className="px-4 py-12 text-center text-sm text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
            Loading…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500 bg-gray-50">
                  <th className="px-4 py-2.5 text-left w-28">Date</th>
                  <th className="px-4 py-2.5 text-left">Description</th>
                  {tab === 'review' && <th className="px-4 py-2.5 text-left min-w-[14rem]">Category</th>}
                  <th className="px-4 py-2.5 text-right w-32">Spent</th>
                  <th className="px-4 py-2.5 text-right w-32">Received</th>
                  {tab === 'review' && <th className="px-4 py-2.5 text-right w-44">Action</th>}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">
                      Nothing here.
                    </td>
                  </tr>
                ) : (
                  rows.map((t) => {
                    const spent = t.transactionType === 'DEBIT';
                    return (
                      <tr key={t.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-sm text-gray-500 whitespace-nowrap">{formatDate(t.transactionDate)}</td>
                        <td className="px-4 py-2.5 text-sm font-medium text-gray-900">{t.description || '—'}</td>
                        {tab === 'review' && (
                          <td className="px-4 py-2.5">
                            <select
                              value={pickFor(t.id)}
                              onChange={(e) => setPicks((p) => ({ ...p, [t.id]: e.target.value }))}
                              className="w-full max-w-[13rem] px-2 py-1.5 text-sm rounded-md border border-gray-300 bg-white focus:outline-none focus:ring-1 focus:ring-primary-500"
                            >
                              {categoryAccounts.length === 0 && <option value="">No accounts</option>}
                              {categoryAccounts.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.accountNumber} · {a.name}
                                </option>
                              ))}
                            </select>
                          </td>
                        )}
                        <td className="px-4 py-2.5 text-sm text-right tabular-nums text-gray-900">{spent ? formatMoney(num(t.amount)) : ''}</td>
                        <td className="px-4 py-2.5 text-sm text-right tabular-nums text-green-700">{!spent ? formatMoney(num(t.amount)) : ''}</td>
                        {tab === 'review' && (
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            <div className="inline-flex gap-1">
                              <button
                                className={added[t.id] ? 'btn-secondary text-xs py-1.5 px-3 opacity-60 cursor-default' : 'btn-primary text-xs py-1.5 px-3'}
                                disabled={added[t.id] || !pickFor(t.id) || pendingId === t.id}
                                onClick={() => addRow(t.id)}
                              >
                                {pendingId === t.id ? (
                                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                                ) : (
                                  <Check className="w-3.5 h-3.5 mr-1" />
                                )}
                                {added[t.id] ? 'Added' : 'Add'}
                              </button>
                              <button
                                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                                title="Exclude"
                                onClick={() => exclude.mutate(t.id)}
                              >
                                <Ban className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-gray-400 mt-3">
        Transactions flow in from the linked bank via Stripe Financial Connections. Accepting a row posts it to the
        general ledger under the chosen account.
      </p>
    </div>
  );
}
