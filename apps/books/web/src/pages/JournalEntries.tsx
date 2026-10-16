import { useState } from 'react';
import { Plus, Search, Eye, Edit, CheckCircle, XCircle, RotateCcw } from 'lucide-react';
import clsx from 'clsx';

const journalEntries = [
  { id: 'GJ-2024-000001', date: '2024-01-15', description: 'Customer payment received', debit: 5000, credit: 5000, status: 'POSTED', type: 'GENERAL' },
  { id: 'GJ-2024-000002', date: '2024-01-14', description: 'Office supplies purchase', debit: 250, credit: 250, status: 'POSTED', type: 'GENERAL' },
  { id: 'GJ-2024-000003', date: '2024-01-14', description: 'AWS subscription payment', debit: 1200, credit: 1200, status: 'DRAFT', type: 'GENERAL' },
  { id: 'AJ-2024-000001', date: '2024-01-13', description: 'Depreciation - December', debit: 2500, credit: 2500, status: 'POSTED', type: 'ADJUSTING' },
  { id: 'GJ-2024-000004', date: '2024-01-12', description: 'Consulting revenue', debit: 8500, credit: 8500, status: 'POSTED', type: 'GENERAL' },
  { id: 'GJ-2024-000005', date: '2024-01-11', description: 'Rent payment - January', debit: 3000, credit: 3000, status: 'POSTED', type: 'GENERAL' },
  { id: 'RV-2024-000001', date: '2024-01-10', description: 'Reversal - Duplicate entry', debit: 500, credit: 500, status: 'POSTED', type: 'REVERSING' },
];

export function JournalEntries() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'POSTED':
        return <span className="badge-success"><CheckCircle className="w-3 h-3 mr-1" />Posted</span>;
      case 'DRAFT':
        return <span className="badge-warning">Draft</span>;
      case 'VOIDED':
        return <span className="badge-danger"><XCircle className="w-3 h-3 mr-1" />Voided</span>;
      default:
        return <span className="badge">{status}</span>;
    }
  };

  const getTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      GENERAL: 'bg-blue-100 text-blue-800',
      ADJUSTING: 'bg-purple-100 text-purple-800',
      CLOSING: 'bg-gray-100 text-gray-800',
      REVERSING: 'bg-orange-100 text-orange-800',
    };
    return <span className={clsx('badge', colors[type] || 'bg-gray-100 text-gray-800')}>{type}</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Journal Entries</h1>
          <p className="text-gray-500 mt-1">Record and manage general ledger entries</p>
        </div>
        <button className="btn-primary">
          <Plus className="w-4 h-4 mr-2" />
          New Entry
        </button>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search entries..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input pl-9"
              />
            </div>
            <div className="flex gap-2">
              {['ALL', 'POSTED', 'DRAFT'].map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={clsx(
                    'px-3 py-1.5 text-sm rounded-lg transition-colors',
                    statusFilter === status
                      ? 'bg-primary-100 text-primary-700 font-medium'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  )}
                >
                  {status === 'ALL' ? 'All' : status.charAt(0) + status.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Entry #</th>
                <th>Date</th>
                <th>Description</th>
                <th>Type</th>
                <th className="text-right">Debit</th>
                <th className="text-right">Credit</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {journalEntries.map((entry) => (
                <tr key={entry.id}>
                  <td className="font-mono text-primary-600">{entry.id}</td>
                  <td className="text-gray-500">{entry.date}</td>
                  <td>{entry.description}</td>
                  <td>{getTypeBadge(entry.type)}</td>
                  <td className="text-right font-mono">${entry.debit.toLocaleString()}</td>
                  <td className="text-right font-mono">${entry.credit.toLocaleString()}</td>
                  <td>{getStatusBadge(entry.status)}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button className="p-1.5 hover:bg-gray-100 rounded-lg" title="View">
                        <Eye className="w-4 h-4 text-gray-400" />
                      </button>
                      {entry.status === 'DRAFT' && (
                        <button className="p-1.5 hover:bg-gray-100 rounded-lg" title="Edit">
                          <Edit className="w-4 h-4 text-gray-400" />
                        </button>
                      )}
                      {entry.status === 'POSTED' && (
                        <button className="p-1.5 hover:bg-gray-100 rounded-lg" title="Reverse">
                          <RotateCcw className="w-4 h-4 text-gray-400" />
                        </button>
                      )}
                    </div>
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
