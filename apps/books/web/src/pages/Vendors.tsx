import { useState } from 'react';
import { Plus, Search, Mail, Phone, MoreVertical, FileText, Loader2 } from 'lucide-react';
import { useVendors } from '../hooks/useParties';
import { useBills } from '../hooks/useBills';
import { num } from '../hooks/useOrgList';
import { formatMoney, initials } from '../lib/format';

export function Vendors() {
  const [search, setSearch] = useState('');
  const vendorsQ = useVendors(search.trim() || undefined);
  const billsQ = useBills();
  const vendors = vendorsQ.data?.items ?? [];

  // Bill count per vendor, from the org's bills.
  const billCount = new Map<string, number>();
  for (const bill of billsQ.data?.items ?? []) {
    billCount.set(bill.vendorId, (billCount.get(bill.vendorId) ?? 0) + 1);
  }
  const is1099 = (v: (typeof vendors)[number]) => v.is1099 ?? v.requires1099 ?? false;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendors</h1>
          <p className="text-gray-500 mt-1">Manage your vendor accounts and payments</p>
        </div>
        <button className="btn-primary">
          <Plus className="w-4 h-4 mr-2" />
          Add Vendor
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="stat-value">{vendorsQ.data?.total ?? 0}</p>
          <p className="stat-label">Total Vendors</p>
        </div>
        <div className="stat-card">
          <p className="stat-value text-red-600">{formatMoney(vendors.reduce((sum, v) => sum + num(v.balance), 0))}</p>
          <p className="stat-label">Total Payables</p>
        </div>
        <div className="stat-card">
          <p className="stat-value">{billsQ.data?.total ?? 0}</p>
          <p className="stat-label">Total Bills</p>
        </div>
        <div className="stat-card">
          <p className="stat-value text-purple-600">{vendors.filter(is1099).length}</p>
          <p className="stat-label">1099 Vendors</p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search vendors..."
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
                <th>Vendor</th>
                <th>Contact</th>
                <th>Bills</th>
                <th>1099</th>
                <th className="text-right">Balance</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {vendorsQ.isLoading && (
                <tr>
                  <td colSpan={6} className="text-center text-gray-400 py-8">
                    <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
                    Loading…
                  </td>
                </tr>
              )}
              {vendorsQ.isError && (
                <tr>
                  <td colSpan={6} className="text-center text-red-600 py-8">
                    {(vendorsQ.error as Error).message || 'Vendors could not be loaded.'}
                  </td>
                </tr>
              )}
              {vendorsQ.isSuccess && vendors.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-gray-500 py-8">
                    {search ? 'No vendors match your search.' : 'No vendors yet.'}
                  </td>
                </tr>
              )}
              {vendors.map((vendor) => (
                <tr key={vendor.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                        <span className="text-sm font-medium text-orange-700">
                          {initials(vendor.name)}
                        </span>
                      </div>
                      <span className="font-medium">{vendor.name}</span>
                    </div>
                  </td>
                  <td>
                    <div className="space-y-1">
                      {vendor.email && (
                        <div className="flex items-center gap-1 text-sm text-gray-500">
                          <Mail className="w-3 h-3" />
                          {vendor.email}
                        </div>
                      )}
                      {vendor.phone && (
                        <div className="flex items-center gap-1 text-sm text-gray-500">
                          <Phone className="w-3 h-3" />
                          {vendor.phone}
                        </div>
                      )}
                      {!vendor.email && !vendor.phone && <span className="text-sm text-gray-400">-</span>}
                    </div>
                  </td>
                  <td>{billCount.get(vendor.id) ?? 0}</td>
                  <td>
                    {is1099(vendor) ? (
                      <span className="badge bg-purple-100 text-purple-800">
                        <FileText className="w-3 h-3 mr-1" />
                        1099
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="text-right font-mono">
                    <span className={num(vendor.balance) > 0 ? 'text-red-600' : ''}>
                      {formatMoney(num(vendor.balance))}
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
