import { Plus, Search, Mail, Phone, MoreVertical } from 'lucide-react';

const customers = [
  { id: '1', name: 'Acme Corp', email: 'billing@acme.com', phone: '(555) 123-4567', balance: 12500, invoices: 5 },
  { id: '2', name: 'TechStart Inc', email: 'ap@techstart.io', phone: '(555) 234-5678', balance: 8750, invoices: 3 },
  { id: '3', name: 'Global Solutions', email: 'finance@globalsol.com', phone: '(555) 345-6789', balance: 0, invoices: 8 },
  { id: '4', name: 'Innovate LLC', email: 'accounts@innovate.co', phone: '(555) 456-7890', balance: 23000, invoices: 12 },
  { id: '5', name: 'Summit Partners', email: 'billing@summit.com', phone: '(555) 567-8901', balance: 5200, invoices: 2 },
];

export function Customers() {
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
          <p className="stat-value">{customers.length}</p>
          <p className="stat-label">Total Customers</p>
        </div>
        <div className="stat-card">
          <p className="stat-value text-green-600">${customers.reduce((sum, c) => sum + c.balance, 0).toLocaleString()}</p>
          <p className="stat-label">Total Receivables</p>
        </div>
        <div className="stat-card">
          <p className="stat-value">{customers.reduce((sum, c) => sum + c.invoices, 0)}</p>
          <p className="stat-label">Total Invoices</p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search customers..." className="input pl-9" />
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
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                        <span className="text-sm font-medium text-primary-700">
                          {customer.name.split(' ').map(n => n[0]).join('')}
                        </span>
                      </div>
                      <span className="font-medium">{customer.name}</span>
                    </div>
                  </td>
                  <td>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1 text-sm text-gray-500">
                        <Mail className="w-3 h-3" />
                        {customer.email}
                      </div>
                      <div className="flex items-center gap-1 text-sm text-gray-500">
                        <Phone className="w-3 h-3" />
                        {customer.phone}
                      </div>
                    </div>
                  </td>
                  <td>{customer.invoices}</td>
                  <td className="text-right font-mono">
                    <span className={customer.balance > 0 ? 'text-green-600' : ''}>
                      ${customer.balance.toLocaleString()}
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
