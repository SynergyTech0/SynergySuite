import { useState } from 'react';
import { CreditCard, RefreshCw, CheckCircle, Wallet, Layers } from 'lucide-react';
import clsx from 'clsx';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader, StatGrid, StatCard, Card, DataTable, StatusPill } from '../components/ui';
import type { Column } from '../components/ui';
import { formatMoney, formatDate } from '../lib/format';
import { apiFetch } from '../lib/api';
import { useAuth } from '../stores/authStore';
import { useAccounts } from '../hooks/useAccounts';

type IssuedCard = {
  id: string;
  last4: string;
  status: string;
  type: string;
  cardholder?: string | null;
  exp_month: number;
  exp_year: number;
  limits: Record<string, number>;
};

type CardTxn = {
  id: string;
  amount: number; // cents, negative = spend
  type: string;
  merchant?: string | null;
  created: number;
  posting: { accountId: string; journalId?: string | null } | null;
};

function useCardsOverview() {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useQuery({
    queryKey: ['cards-overview', orgId],
    queryFn: () =>
      apiFetch<{ balanceCents: number; cards: IssuedCard[]; postedCount: number; disclosures: any }>(
        `/organizations/${orgId}/cards/overview`,
      ),
    enabled: !!orgId,
  });
}

function useCardTxns() {
  const orgId = useAuth((s) => s.user?.organizationId);
  return useQuery({
    queryKey: ['cards-txns', orgId],
    queryFn: () => apiFetch<{ transactions: CardTxn[] }>(`/organizations/${orgId}/cards/transactions`),
    enabled: !!orgId,
  });
}

export function SpendCards() {
  const orgId = useAuth((s) => s.user?.organizationId);
  const qc = useQueryClient();
  const overview = useCardsOverview();
  const txns = useCardTxns();
  const accountsQ = useAccounts();
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');

  const expenseAccounts = (accountsQ.data ?? []).filter(
    (a: any) => a.accountType === 'EXPENSE' && a.isActive !== false,
  );
  const defaultAccountId = expenseAccounts[0]?.id ?? '';

  const categorize = useMutation({
    mutationFn: ({ txnId, accountId }: { txnId: string; accountId: string }) =>
      apiFetch(`/organizations/${orgId}/cards/transactions/${txnId}/categorize`, {
        method: 'POST',
        body: JSON.stringify({ accountId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cards-txns', orgId] });
      qc.invalidateQueries({ queryKey: ['cards-overview', orgId] });
      setMsg('Posted to the books — journal entry created.');
    },
    onError: (e) => setMsg((e as Error)?.message || 'Could not post the transaction.'),
  });

  const cardColumns: Column<IssuedCard>[] = [
    {
      key: 'card', header: 'Card',
      render: (c) => (
        <span className="font-medium text-gray-900 inline-flex items-center">
          <CreditCard className="w-4 h-4 mr-2 text-primary-600" />
          •••• {c.last4}
        </span>
      ),
    },
    { key: 'holder', header: 'Cardholder', render: (c) => <span>{c.cardholder ?? '—'}</span> },
    { key: 'type', header: 'Type', render: (c) => <span className="uppercase text-xs text-gray-500">{c.type}</span> },
    {
      key: 'limits', header: 'Limits', render: (c) => (
        <span className="text-gray-500 text-xs tabular-nums">
          {c.limits?.per_authorization ? `${formatMoney(c.limits.per_authorization / 100)}/txn` : ''}
          {c.limits?.monthly ? ` · ${formatMoney(c.limits.monthly / 100)}/mo` : ''}
        </span>
      ),
    },
    { key: 'exp', header: 'Expires', render: (c) => <span className="text-gray-500">{c.exp_month}/{c.exp_year}</span> },
    { key: 'status', header: 'Status', render: (c) => <StatusPill status={c.status.toUpperCase()} /> },
  ];

  const txnColumns: Column<CardTxn>[] = [
    { key: 'date', header: 'Date', render: (t) => <span className="text-gray-500">{formatDate(new Date(t.created * 1000).toISOString())}</span> },
    { key: 'merchant', header: 'Merchant', render: (t) => <span className="font-medium text-gray-900">{t.merchant ?? '—'}</span> },
    {
      key: 'amount', header: 'Amount', align: 'right',
      render: (t) => (
        <span className={clsx('tabular-nums', t.amount > 0 && 'text-green-600')}>
          {formatMoney(Math.abs(t.amount) / 100)}{t.amount > 0 ? ' (refund)' : ''}
        </span>
      ),
    },
    {
      key: 'post', header: 'Books', align: 'right',
      render: (t) =>
        t.posting ? (
          <span className="inline-flex items-center text-xs text-green-700">
            <CheckCircle className="w-3.5 h-3.5 mr-1" /> Posted
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <select
              className="text-xs border border-gray-300 rounded px-1 py-1 max-w-[180px]"
              value={picks[t.id] ?? defaultAccountId}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setPicks((p) => ({ ...p, [t.id]: e.target.value }))}
            >
              {expenseAccounts.map((a: any) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <button
              className="btn-secondary text-xs py-1 px-2"
              disabled={categorize.isPending || !(picks[t.id] ?? defaultAccountId)}
              onClick={(e) => {
                e.stopPropagation();
                setMsg('');
                categorize.mutate({ txnId: t.id, accountId: picks[t.id] ?? defaultAccountId });
              }}
            >
              Post
            </button>
          </span>
        ),
    },
  ];

  const cards = overview.data?.cards ?? [];
  const transactions = txns.data?.transactions ?? [];
  const unposted = transactions.filter((t) => !t.posting).length;

  return (
    <div>
      <PageHeader
        title="Spend cards"
        subtitle="Synergy-issued cards — the card feed and the ledger are one system"
        actions={
          <button
            className="btn-secondary"
            onClick={() => { overview.refetch(); txns.refetch(); }}
            disabled={overview.isFetching || txns.isFetching}
          >
            <RefreshCw className={clsx('w-4 h-4 mr-2', (overview.isFetching || txns.isFetching) && 'animate-spin')} />
            Refresh
          </button>
        }
      />

      {msg && (
        <div className="mb-4 text-sm text-gray-700 bg-primary-50 border border-primary-100 rounded-lg px-4 py-2">
          {msg}
        </div>
      )}

      <StatGrid>
        <StatCard label="Issuing balance" value={formatMoney((overview.data?.balanceCents ?? 0) / 100)} icon={Wallet} tone="default" />
        <StatCard label="Active cards" value={String(cards.filter((c) => c.status === 'active').length)} icon={CreditCard} tone="default" />
        <StatCard label="Needs posting" value={String(unposted)} icon={Layers} tone={unposted > 0 ? 'warning' : 'default'} />
        <StatCard label="Posted to GL" value={String(overview.data?.postedCount ?? 0)} icon={CheckCircle} tone="success" />
      </StatGrid>

      <h2 className="text-sm font-semibold text-gray-700 mb-2">Cards</h2>
      <Card>
        <DataTable columns={cardColumns} rows={cards} rowKey={(c) => c.id}
          emptyMessage="No cards issued yet — cards are created through the Synergy card program." />
      </Card>

      <h2 className="text-sm font-semibold text-gray-700 mb-2 mt-6">Card transactions</h2>
      <Card>
        <DataTable columns={txnColumns} rows={transactions} rowKey={(t) => t.id}
          emptyMessage="No card transactions yet. Spend on a Synergy card shows up here for one-click posting." />
      </Card>

      {overview.data?.disclosures && (
        <p className="mt-6 text-xs text-gray-400 max-w-3xl">
          {overview.data.disclosures.bank_attribution} {overview.data.disclosures.funds_statement}
        </p>
      )}
    </div>
  );
}
