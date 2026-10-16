import { Plus, CreditCard, Building2, RefreshCw, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';
import clsx from 'clsx';

const bankAccounts = [
  {
    id: '1',
    name: 'Business Checking',
    institution: 'Chase Bank',
    accountNumber: '****4521',
    type: 'CHECKING',
    balance: 85432.50,
    lastSync: '2024-01-15 10:30 AM',
    status: 'CONNECTED',
    unreconciled: 12,
  },
  {
    id: '2',
    name: 'Business Savings',
    institution: 'Chase Bank',
    accountNumber: '****7892',
    type: 'SAVINGS',
    balance: 40000.00,
    lastSync: '2024-01-15 10:30 AM',
    status: 'CONNECTED',
    unreconciled: 3,
  },
  {
    id: '3',
    name: 'Credit Card',
    institution: 'American Express',
    accountNumber: '****3456',
    type: 'CREDIT_CARD',
    balance: -8750.25,
    lastSync: '2024-01-14 03:45 PM',
    status: 'CONNECTED',
    unreconciled: 28,
  },
  {
    id: '4',
    name: 'Line of Credit',
    institution: 'Bank of America',
    accountNumber: '****9012',
    type: 'LINE_OF_CREDIT',
    balance: -15000.00,
    lastSync: null,
    status: 'DISCONNECTED',
    unreconciled: 0,
  },
];

export function BankAccounts() {
  const formatCurrency = (amount: number) => {
    const formatted = Math.abs(amount).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });
    return amount < 0 ? `(${formatted})` : formatted;
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'CHECKING':
      case 'SAVINGS':
        return Building2;
      default:
        return CreditCard;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bank Accounts</h1>
          <p className="text-gray-500 mt-1">Connect and manage your financial accounts</p>
        </div>
        <button className="btn-primary">
          <Plus className="w-4 h-4 mr-2" />
          Connect Account
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="stat-card">
          <p className="stat-value text-green-600">
            ${bankAccounts.filter(a => a.balance > 0).reduce((sum, a) => sum + a.balance, 0).toLocaleString()}
          </p>
          <p className="stat-label">Cash on Hand</p>
        </div>
        <div className="stat-card">
          <p className="stat-value text-red-600">
            ${Math.abs(bankAccounts.filter(a => a.balance < 0).reduce((sum, a) => sum + a.balance, 0)).toLocaleString()}
          </p>
          <p className="stat-label">Credit Balances</p>
        </div>
        <div className="stat-card">
          <p className="stat-value text-blue-600">
            {bankAccounts.reduce((sum, a) => sum + a.unreconciled, 0)}
          </p>
          <p className="stat-label">Unreconciled Transactions</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {bankAccounts.map((account) => {
          const Icon = getTypeIcon(account.type);
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
                      <h3 className="font-semibold text-gray-900">{account.name}</h3>
                      <p className="text-sm text-gray-500">{account.institution} {account.accountNumber}</p>
                    </div>
                  </div>
                  {account.status === 'CONNECTED' ? (
                    <span className="badge-success">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Connected
                    </span>
                  ) : (
                    <span className="badge-danger">
                      <AlertCircle className="w-3 h-3 mr-1" />
                      Disconnected
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
                    {account.lastSync ? (
                      <>Last synced: {account.lastSync}</>
                    ) : (
                      <>Not connected</>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {account.unreconciled > 0 && (
                      <span className="badge-warning">
                        {account.unreconciled} to review
                      </span>
                    )}
                    <button className="btn-secondary text-xs py-1 px-2">
                      <RefreshCw className="w-3 h-3 mr-1" />
                      Sync
                    </button>
                    <button className="btn-secondary text-xs py-1 px-2">
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
    </div>
  );
}
