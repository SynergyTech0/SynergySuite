import { Plus, Search, Mail, Phone, MoreVertical, FileText } from 'lucide-react';

const vendors = [
  { id: '1', name: 'Office Depot', email: 'accounts@officedepot.com', phone: '(800) 123-4567', balance: 1250, bills: 8, is1099: false },
  { id: '2', name: 'John Smith Consulting', email: 'john@smithconsulting.com', phone: '(555) 234-5678', balance: 5000, bills: 3, is1099: true },
  { id: '3', name: 'AWS', email: 'billing@aws.amazon.com', phone: '(888) 345-6789', balance: 2400, bills: 12, is1099: false },
  { id: '4', name: 'Acme Landlord LLC', email: 'rent@acmelandlord.com', phone: '(555) 456-7890', balance: 0, bills: 6, is1099: false },
  { id: '5', name: 'Jane Doe Design', email: 'jane@doedesign.co', phone: '(555) 567-8901', balance: 3500, bills: 2, is1099: true },
];

export function Vendors() {
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
          <p className="stat-value">{vendors.length}</p>
          <p className="stat-label">Total Vendors</p>
        </div>
        <div className="stat-card">
          <p className="stat-value text-red-600">${vendors.reduce((sum, v) => sum + v.balance, 0).toLocaleString()}</p>
          <p className="stat-label">Total Payables</p>
        </div>
        <div className="stat-card">
          <p className="stat-value">{vendors.reduce((sum, v) => sum + v.bills, 0)}</p>
          <p className="stat-label">Total Bills</p>
        </div>
        <div className="stat-card">
          <p className="stat-value text-purple-600">{vendors.filter(v => v.is1099).length}</p>
          <p className="stat-label">1099 Vendors</p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search vendors..." className="input pl-9" />
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
              {vendors.map((vendor) => (
                <tr key={vendor.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                        <span className="text-sm font-medium text-orange-700">
                          {vendor.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                        </span>
                      </div>
                      <span className="font-medium">{vendor.name}</span>
                    </div>
                  </td>
                  <td>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1 text-sm text-gray-500">
                        <Mail className="w-3 h-3" />
                        {vendor.email}
                      </div>
                      <div className="flex items-center gap-1 text-sm text-gray-500">
                        <Phone className="w-3 h-3" />
                        {vendor.phone}
                      </div>
                    </div>
                  </td>
                  <td>{vendor.bills}</td>
                  <td>
                    {vendor.is1099 ? (
                      <span className="badge bg-purple-100 text-purple-800">
                        <FileText className="w-3 h-3 mr-1" />
                        1099
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="text-right font-mono">
                    <span className={vendor.balance > 0 ? 'text-red-600' : ''}>
                      ${vendor.balance.toLocaleString()}
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
