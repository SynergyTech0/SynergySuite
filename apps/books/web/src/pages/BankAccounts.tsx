import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, CreditCard, Building2, RefreshCw, CheckCircle, AlertCircle, ExternalLink, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useBankAccounts, useConnectBank, useSyncBank } from '../hooks/useBankAccounts';
import { useBankTransactions } from '../hooks/useBankTransactions';
import { useAccounts } from '../hooks/useAccounts';
import { num } from '../hooks/useOrgList';

const DEBT_TYPES = ['CREDIT_CARD', 'LINE_OF_CREDIT'];

export function BankAccounts() {
  const navigate = useNavigate();
  const accountsQ = useBankAccounts();
  const reviewQ = useBankTransactions('UNMATCHED', 1000);
  const glAccounts = useAccounts();
  const connectBank = useConnectBank();
  const sync = useSyncBank();

  const [connectOpen, setConnectOpen] = useState(false);
  const [glAccountId, setGlAccountId] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectMsg, setConnectMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const bankAccounts = (accountsQ.data ?? []).map((a) => {
    const raw = num(a.currentBalance);
    // Card and credit-line balances are money owed: show them as negative.
    const balance = DEBT_TYPES.includes(a.accountType ?? '') ? -Math.abs(raw) : raw;
    return { ...a, balance };
  });

  const unreconciledByAccount = new Map<string, number>();
  for (const t of reviewQ.data?.items ?? []) {
    unreconciledByAccount.set(t.bankAccountId, (unreconciledByAccount.get(t.bankAccountId) ?? 0) + 1);
  }

  // GL accounts a bank connection can post to: bank accounts first, else any asset or liability.
  const glChoices = (glAccounts.data ?? []).filter(
    (a) => a.isActive !== false && (a.isBankAccount || ['ASSET', 'LIABILITY'].includes(a.accountType)),
  );
  const pickedGl = glAccountId || glChoices.find((a) => a.isBankAccount)?.id || glChoices[0]?.id || '';

  const connect = async () => {
    if (!pickedGl) return;
    setConnecting(true);
    setConnectMsg(null);
    try {
      const linked = await connectBank(pickedGl);
      setConnectMsg({ ok: true, text: `Linked ${linked} account${linked === 1 ? '' : 's'}.` });
      setConnectOpen(false);
    } catch (e) {
      setConnectMsg({ ok: false, text: (e as Error).message || 'Bank connection failed.' });
    } finally {
      setConnecting(false);
    }
  };

  const formatCurrency = (amount: number) => {
    const formatted = Math.abs(amount).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });
    return amount < 0 ? `(${formatted})` : formatted;
  };

  const getTypeIcon = (type?: string) => {
    switch (type) {
      case 'CHECKING':
      case 'SAVINGS':
      case 'MONEY_MARKET':
        return Building2;
      default:
        return CreditCard;
    }
  };

  const cashOnHand = bankAccounts.filter((a) => a.balance > 0).reduce((sum, a) => sum + a.balance, 0);
  const creditBalances = Math.abs(bankAccounts.filter((a) => a.balance < 0).reduce((sum, a) => sum + a.balance, 0));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bank Accounts</h1>
          <p className="text-gray-500 mt-1">Connect and manage your financial accounts</p>
        </div>
        <button className="btn-primary" onClick={() => setConnectOpen((o) => !o)}>
          <Plus className="w-4 h-4 mr-2" />
          Connect Account
        </button>
      </div>

      {connectOpen && (
        <div className="card">
          <div className="card-body flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Post bank activity to</label>
              <select className="input" value={pickedGl} onChange={(e) => setGlAccountId(e.target.value)}>
                {glChoices.length === 0 && <option value="">No asset or liability accounts yet</option>}
                {glChoices.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.accountNumber} · {a.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn-primary" onClick={connect} disabled={!pickedGl || connecting}>
              {connecting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Continue to your bank
            </button>
          </div>
        </div>
      )}
      {connectMsg && (
        <p className={clsx('text-sm', connectMsg.ok ? 'text-green-700' : 'text-red-600')}>{connectMsg.text}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="stat-card">
          <p className="stat-value text-green-600">{formatCurrency(cashOnHand)}</p>
          <p className="stat-label">Cash on Hand</p>
        </div>
        <div className="stat-card">
          <p className="stat-value text-red-600">{formatCurrency(creditBalances)}</p>
          <p className="stat-label">Credit Balances</p>
        </div>
        <div className="stat-card">
          <p className="stat-value text-blue-600">{reviewQ.data?.total ?? 0}</p>
          <p className="stat-label">Unreconciled Transactions</p>
        </div>
      </div>

      {accountsQ.isLoading ? (
        <div className="card">
          <div className="card-body text-center text-sm text-gray-400 py-12">
            <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
            Loading…
          </div>
        </div>
      ) : accountsQ.isError ? (
        <div className="card">
          <div className="card-body text-center text-sm text-red-600 py-12">
            {(accountsQ.error as Error).message || 'Bank accounts could not be loaded.'}
          </div>
        </div>
      ) : bankAccounts.length === 0 ? (
        <div className="card">
          <div className="card-body text-center py-12">
            <p className="font-medium text-gray-900">No bank accounts yet</p>
            <p className="text-sm text-gray-500 mt-1">Connect your bank to pull balances and transactions into the books.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {bankAccounts.map((account) => {
            const Icon = getTypeIcon(account.accountType);
            const linked = !!account.plaidItemId;
            const unreconciled = unreconciledByAccount.get(account.id) ?? 0;
            const syncing = sync.isPending && sync.variables === account.id;
            return (
              <div key={account.id} className="card">
                <div className="card-body">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      <div className={clsx(
                        'w-12 h-12 rounded-xl flex items-center justify-center',
                        account.balance >= 0 ? 'bg-green-100' : 'bg-red-100'
                      )}>
                        <Icon className={clsx(
                          'w-6 h-6',
                          account.balance >= 0 ? 'text-green-600' : 'text-red-600'
                        )} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{account.accountName}</h3>
                        <p className="text-sm text-gray-500">
                          {account.bankName} ****{(account.accountNumber || '').slice(-4)}
                        </p>
                      </div>
                    </div>
                    {linked ? (
                      <span className="badge-success">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Connected
                      </span>
                    ) : (
                      <span className="badge bg-gray-100 text-gray-700">
                        <AlertCircle className="w-3 h-3 mr-1" />
                        Manual
                      </span>
                    )}
                  </div>

                  <div className="mt-6">
                    <p className={clsx(
                      'text-2xl font-bold font-mono',
                      account.balance >= 0 ? 'text-gray-900' : 'text-red-600'
                    )}>
                      {formatCurrency(account.balance)}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">Current Balance</p>
                  </div>

                  <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between">
                    <div className="text-sm text-gray-500">
                      {account.lastSyncAt ? (
                        <>Last synced: {new Date(account.lastSyncAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</>
                      ) : linked ? (
                        <>Not synced yet</>
                      ) : (
                        <>Not connected</>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {unreconciled > 0 && (
                        <span className="badge-warning">
                          {unreconciled} to review
                        </span>
                      )}
                      {linked && (
                        <button
                          className="btn-secondary text-xs py-1 px-2"
                          onClick={() => sync.mutate(account.id)}
                          disabled={sync.isPending}
                        >
                          <RefreshCw className={clsx('w-3 h-3 mr-1', syncing && 'animate-spin')} />
                          Sync
                        </button>
                      )}
                      <button className="btn-secondary text-xs py-1 px-2" onClick={() => navigate('/banking/transactions')}>
                        <ExternalLink className="w-3 h-3 mr-1" />
                        View
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {sync.isError && <p className="text-sm text-red-600">{(sync.error as Error).message || 'Sync failed.'}</p>}
    </div>
  );
}
