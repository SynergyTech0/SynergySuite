import { useState } from 'react';
import { Plus, Search, Mail, Phone, MoreVertical, Loader2 } from 'lucide-react';
import { useCustomers } from '../hooks/useParties';
import { useOrgList, num } from '../hooks/useOrgList';
import type { ApiInvoice } from '../hooks/useInvoices';
import { formatMoney, initials } from '../lib/format';

export function Customers() {
  const [search, setSearch] = useState('');
  const customersQ = useCustomers(search.trim() || undefined);
  const invoicesQ = useOrgList<ApiInvoice>('invoices', { take: 1000 });
  const customers = customersQ.data?.items ?? [];

  // Invoice count per customer, from the org's invoices.
  const invoiceCount = new Map<string, number>();
  for (const inv of invoicesQ.data?.items ?? []) {
    if (inv.customer?.id) invoiceCount.set(inv.customer.id, (invoiceCount.get(inv.customer.id) ?? 0) + 1);
  }
  const totalReceivables = customers.reduce((sum, c) => sum + num(c.balance), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-gray-500 mt-1">Manage your customer accounts</p>
        </div>
        <button className="btn-primary">
          <Plus className="w-4 h-4 mr-2" />
          Add Customer
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="stat-card">
          <p className="stat-value">{customersQ.data?.total ?? 0}</p>
          <p className="stat-label">Total Customers</p>
        </div>
        <div className="stat-card">
          <p className="stat-value text-green-600">{formatMoney(totalReceivables)}</p>
          <p className="stat-label">Total Receivables</p>
        </div>
        <div className="stat-card">
          <p className="stat-value">{invoicesQ.data?.total ?? 0}</p>
          <p className="stat-label">Total Invoices</p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search customers..."
              className="input pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Contact</th>
                <th>Invoices</th>
                <th className="text-right">Balance</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {customersQ.isLoading && (
                <tr>
                  <td colSpan={5} className="text-center text-gray-400 py-8">
                    <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
                    Loading…
                  </td>
                </tr>
              )}
              {customersQ.isError && (
                <tr>
                  <td colSpan={5} className="text-center text-red-600 py-8">
                    {(customersQ.error as Error).message || 'Customers could not be loaded.'}
                  </td>
                </tr>
              )}
              {customersQ.isSuccess && customers.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-gray-500 py-8">
                    {search ? 'No customers match your search.' : 'No customers yet.'}
                  </td>
                </tr>
              )}
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                        <span className="text-sm font-medium text-primary-700">
                          {initials(customer.name)}
                        </span>
                      </div>
                      <span className="font-medium">{customer.name}</span>
                    </div>
                  </td>
                  <td>
                    <div className="space-y-1">
                      {customer.email && (
                        <div className="flex items-center gap-1 text-sm text-gray-500">
                          <Mail className="w-3 h-3" />
                          {customer.email}
                        </div>
                      )}
                      {customer.phone && (
                        <div className="flex items-center gap-1 text-sm text-gray-500">
                          <Phone className="w-3 h-3" />
                          {customer.phone}
                        </div>
                      )}
                      {!customer.email && !customer.phone && <span className="text-sm text-gray-400">-</span>}
                    </div>
                  </td>
                  <td>{invoiceCount.get(customer.id) ?? 0}</td>
                  <td className="text-right font-mono">
                    <span className={num(customer.balance) > 0 ? 'text-green-600' : ''}>
                      {formatMoney(num(customer.balance))}
                    </span>
                  </td>
                  <td>
                    <button className="p-1.5 hover:bg-gray-100 rounded-lg">
                      <MoreVertical className="w-4 h-4 text-gray-400" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
