import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Send, Clock, CheckCircle, AlertCircle, DollarSign, X, Loader2, CreditCard, RefreshCw, ExternalLink } from 'lucide-react';
import clsx from 'clsx';
import { PageHeader, StatGrid, StatCard, Card, Toolbar, DataTable, StatusPill } from '../components/ui';
import type { Column } from '../components/ui';
import { formatMoney, formatDate } from '../lib/format';
import { useInvoices, useRecordPayment, useStripeCollect, useStripeRefresh } from '../hooks/useInvoices';
import type { ApiInvoice } from '../hooks/useInvoices';

const num = (v: string | number | undefined): number =>
  typeof v === 'number' ? v : parseFloat(v || '0') || 0;

export function Invoices() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const { data, isLoading, isError, error } = useInvoices({ search: searchQuery, status: statusFilter });
  const recordPayment = useRecordPayment();
  const stripeCollect = useStripeCollect();
  const stripeRefresh = useStripeRefresh();

  const [selected, setSelected] = useState<ApiInvoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [stripeMsg, setStripeMsg] = useState('');

  const collectOnline = (r: ApiInvoice) => {
    setStripeMsg('');
    stripeCollect.mutate(
      { invoiceId: r.id },
      {
        onSuccess: (d) => {
          navigator.clipboard?.writeText(d.hostedUrl).catch(() => {});
          window.open(d.hostedUrl, '_blank', 'noopener');
          setStripeMsg(`Pay-online link created for ${r.invoiceNumber} (copied to clipboard).`);
        },
        onError: (e) => setStripeMsg((e as Error)?.message || 'Could not create the Stripe invoice.'),
      },
    );
  };

  const refreshStripe = (r: ApiInvoice) => {
    setStripeMsg('');
    stripeRefresh.mutate(r.id, {
      onSuccess: (d) =>
        setStripeMsg(
          d.paymentRecorded
            ? `${r.invoiceNumber} is PAID on Stripe — payment recorded in the books.`
            : `${r.invoiceNumber}: Stripe status is “${d.stripeStatus}”.`,
        ),
      onError: (e) => setStripeMsg((e as Error)?.message || 'Could not refresh Stripe status.'),
    });
  };

  const invoices = data?.items ?? [];

  const sum = (pred: (i: ApiInvoice) => boolean, val: (i: ApiInvoice) => number) =>
    invoices.filter(pred).reduce((s, i) => s + val(i), 0);
  const outstanding = sum((i) => ['SENT', 'PARTIAL', 'OPEN'].includes(i.status), (i) => num(i.amountDue));
  const overdue = sum((i) => i.status === 'OVERDUE', (i) => num(i.amountDue));
  const partial = sum((i) => i.status === 'PARTIAL', (i) => num(i.amountPaid));
  const paidMtd = sum((i) => i.status === 'PAID', (i) => num(i.totalAmount));

  const columns: Column<ApiInvoice>[] = [
    { key: 'id', header: 'Invoice #', render: (r) => <span className="font-medium text-primary-600">{r.invoiceNumber}</span> },
    { key: 'customer', header: 'Customer', render: (r) => <span className="font-medium text-gray-900">{r.customer?.name ?? '—'}</span> },
    { key: 'date', header: 'Date', render: (r) => <span className="text-gray-500">{formatDate(r.invoiceDate)}</span> },
    { key: 'due', header: 'Due', render: (r) => <span className="text-gray-500">{formatDate(r.dueDate)}</span> },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => <span className="tabular-nums">{formatMoney(num(r.totalAmount))}</span> },
    { key: 'balance', header: 'Balance', align: 'right', render: (r) => <span className="tabular-nums">{formatMoney(num(r.amountDue))}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          {!r.stripeInvoiceId && !['PAID', 'VOIDED', 'WRITTEN_OFF'].includes(r.status) && (
            <button
              className="btn-secondary text-xs py-1 px-2"
              title="Create a hosted Stripe invoice the customer can pay online"
              onClick={(e) => {
                e.stopPropagation();
                collectOnline(r);
              }}
              disabled={stripeCollect.isPending}
            >
              <CreditCard className="w-3 h-3 mr-1" />
              Collect online
            </button>
          )}
          {r.stripeInvoiceId && (
            <>
              {r.stripeHostedUrl && (
                <a
                  className="btn-secondary text-xs py-1 px-2"
                  href={r.stripeHostedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open the customer's pay-online page"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {r.status !== 'PAID' && (
                <button
                  className="btn-secondary text-xs py-1 px-2"
                  title="Check Stripe for payment; records it in the books when paid"
                  onClick={(e) => {
                    e.stopPropagation();
                    refreshStripe(r);
                  }}
                  disabled={stripeRefresh.isPending}
                >
                  <RefreshCw className={clsx('w-3 h-3', stripeRefresh.isPending && 'animate-spin')} />
                </button>
              )}
            </>
          )}
          <button
            className={clsx('btn-secondary text-xs py-1 px-2', r.status === 'PAID' && 'opacity-50 cursor-not-allowed')}
            onClick={(e) => {
              e.stopPropagation();
              setSelected(r);
              setPaymentAmount('');
            }}
            disabled={r.status === 'PAID'}
          >
            <DollarSign className="w-3 h-3 mr-1" />
            Payment
          </button>
        </div>
      ),
    },
  ];

  const submitPayment = () => {
    if (selected && paymentAmount) {
      recordPayment.mutate(
        { invoiceId: selected.id, amount: parseFloat(paymentAmount) },
        {
          onSuccess: () => {
            setSelected(null);
            setPaymentAmount('');
          },
        },
      );
    }
  };

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Manage customer invoices and payments"
        actions={
          <button className="btn-primary" onClick={() => navigate('/invoices/new')}>
            <Plus className="w-4 h-4 mr-2" />
            New invoice
          </button>
        }
      />

      {stripeMsg && (
        <div className="mb-4 text-sm text-gray-700 bg-primary-50 border border-primary-100 rounded-lg px-4 py-2">
          {stripeMsg}
        </div>
      )}

      <StatGrid>
        <StatCard label="Outstanding" value={formatMoney(outstanding)} icon={Send} tone="default" />
        <StatCard label="Partial" value={formatMoney(partial)} icon={Clock} tone="warning" />
        <StatCard label="Overdue" value={formatMoney(overdue)} icon={AlertCircle} tone="danger" />
        <StatCard label="Paid (MTD)" value={formatMoney(paidMtd)} icon={CheckCircle} tone="success" />
      </StatGrid>

      <Card>
        <Toolbar search={searchQuery} onSearch={setSearchQuery} placeholder="Search invoices…">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="ALL">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="SENT">Sent</option>
            <option value="PARTIAL">Partial</option>
            <option value="PAID">Paid</option>
            <option value="OVERDUE">Overdue</option>
          </select>
        </Toolbar>

        {isLoading ? (
          <div className="px-4 py-12 text-center text-sm text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
            Loading invoices…
          </div>
        ) : isError ? (
          <div className="px-4 py-12 text-center text-sm text-red-500">
            {(error as Error)?.message || 'Failed to load invoices.'}
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={invoices}
            rowKey={(r) => r.id}
            emptyMessage="No invoices yet. Create your first invoice."
          />
        )}
      </Card>

      {/* Record Payment Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">Record payment</h2>
              <button onClick={() => setSelected(null)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-sm text-gray-500">Invoice</p>
                <p className="font-medium">{selected.invoiceNumber}</p>
                <p className="text-sm text-gray-500 mt-2">Customer</p>
                <p className="font-medium">{selected.customer?.name ?? '—'}</p>
                <p className="text-sm text-gray-500 mt-2">Balance due</p>
                <p className="font-medium text-lg tabular-nums">{formatMoney(num(selected.amountDue))}</p>
              </div>
              <div>
                <label className="label">Payment amount</label>
                <input
                  type="number"
                  className="input"
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  max={num(selected.amountDue)}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                />
              </div>
              {recordPayment.isError && (
                <p className="text-sm text-red-600">
                  {(recordPayment.error as Error)?.message || 'Could not record payment.'}
                </p>
              )}
            </div>
            <div className="p-4 border-t bg-gray-50 rounded-b-xl flex gap-2">
              <button onClick={submitPayment} disabled={recordPayment.isPending} className="flex-1 btn-primary">
                {recordPayment.isPending ? 'Recording…' : 'Record payment'}
              </button>
              <button onClick={() => setSelected(null)} className="flex-1 btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
