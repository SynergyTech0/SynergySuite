import { useState } from 'react';
import { Search, Sparkles, CheckCircle, AlertCircle, Clock, BookOpen, ThumbsUp, ThumbsDown, RefreshCw } from 'lucide-react';
import clsx from 'clsx';

const classifications = [
  {
    id: '1',
    transaction: 'Customer Payment - Invoice #1234',
    amount: 5000,
    date: '2024-01-15',
    category: 'Ordinary Income',
    ircCode: 'IRC §61(a)(1)',
    ircTitle: 'Gross income defined - Compensation for services',
    confidence: 0.98,
    status: 'CONFIRMED',
  },
  {
    id: '2',
    transaction: 'Office Supplies - Staples',
    amount: -250,
    date: '2024-01-14',
    category: 'Business Expense',
    ircCode: 'IRC §162(a)',
    ircTitle: 'Trade or business expenses',
    confidence: 0.95,
    status: 'CONFIRMED',
  },
  {
    id: '3',
    transaction: 'Software Subscription - AWS',
    amount: -1200,
    date: '2024-01-14',
    category: 'Business Expense',
    ircCode: 'IRC §162(a)',
    ircTitle: 'Trade or business expenses',
    confidence: 0.92,
    status: 'PENDING',
  },
  {
    id: '4',
    transaction: 'Travel - Client Meeting',
    amount: -450,
    date: '2024-01-12',
    category: 'Travel Expense',
    ircCode: 'IRC §162(a)(2)',
    ircTitle: 'Traveling expenses',
    confidence: 0.78,
    status: 'NEEDS_REVIEW',
    notes: 'May require substantiation for business purpose',
  },
  {
    id: '5',
    transaction: 'Equipment Purchase - Laptop',
    amount: -2500,
    date: '2024-01-10',
    category: 'Capital Expenditure',
    ircCode: 'IRC §179',
    ircTitle: 'Election to expense certain depreciable business assets',
    confidence: 0.89,
    status: 'PENDING',
  },
  {
    id: '6',
    transaction: 'Contractor Payment - John Smith',
    amount: -3000,
    date: '2024-01-08',
    category: 'Contract Labor',
    ircCode: 'IRC §162(a)(1)',
    ircTitle: 'Trade or business expenses - Salaries',
    confidence: 0.94,
    status: 'CONFIRMED',
    notes: '1099 reportable payment',
  },
];

export function TaxClassification() {
  const [statusFilter, setStatusFilter] = useState('ALL');

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'CONFIRMED':
        return <span className="badge-success"><CheckCircle className="w-3 h-3 mr-1" />Confirmed</span>;
      case 'PENDING':
        return <span className="badge-warning"><Clock className="w-3 h-3 mr-1" />Pending</span>;
      case 'NEEDS_REVIEW':
        return <span className="badge-danger"><AlertCircle className="w-3 h-3 mr-1" />Needs Review</span>;
      default:
        return <span className="badge">{status}</span>;
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return 'text-green-600 bg-green-100';
    if (confidence >= 0.8) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tax Classification</h1>
          <p className="text-gray-500 mt-1">AI-powered tax categorization with IRC citations</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary">
            <RefreshCw className="w-4 h-4 mr-2" />
            Reclassify All
          </button>
          <button className="btn-primary">
            <Sparkles className="w-4 h-4 mr-2" />
            Auto-Classify New
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <p className="stat-value text-lg">98.5%</p>
              <p className="text-xs text-gray-500">Accuracy Rate</p>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <p className="stat-value text-lg">{classifications.filter(c => c.status === 'CONFIRMED').length}</p>
              <p className="text-xs text-gray-500">Confirmed</p>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-yellow-100 rounded-lg flex items-center justify-center">
              <Clock className="w-4 h-4 text-yellow-600" />
            </div>
            <div>
              <p className="stat-value text-lg">{classifications.filter(c => c.status === 'PENDING').length}</p>
              <p className="text-xs text-gray-500">Pending Review</p>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
              <AlertCircle className="w-4 h-4 text-red-600" />
            </div>
            <div>
              <p className="stat-value text-lg">{classifications.filter(c => c.status === 'NEEDS_REVIEW').length}</p>
              <p className="text-xs text-gray-500">Needs Attention</p>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search classifications..."
                className="input pl-9"
              />
            </div>
            <div className="flex gap-2">
              {['ALL', 'CONFIRMED', 'PENDING', 'NEEDS_REVIEW'].map((status) => (
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
                  {status === 'ALL' ? 'All' : status.replace('_', ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase())}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="divide-y divide-gray-200">
          {classifications.map((item) => (
            <div key={item.id} className="p-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-gray-900">{item.transaction}</span>
                    {getStatusBadge(item.status)}
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                    <span>{item.date}</span>
                    <span className={item.amount >= 0 ? 'text-green-600 font-mono' : 'text-red-600 font-mono'}>
                      {item.amount >= 0 ? '+' : ''}${item.amount.toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <span className={clsx(
                    'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
                    getConfidenceColor(item.confidence)
                  )}>
                    {Math.round(item.confidence * 100)}% confidence
                  </span>
                </div>
              </div>

              <div className="mt-4 p-3 bg-accent-50 rounded-lg">
                <div className="flex items-start gap-3">
                  <BookOpen className="w-5 h-5 text-accent-600 mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-accent-800">{item.category}</span>
                      <span className="badge bg-accent-200 text-accent-900 text-xs">{item.ircCode}</span>
                    </div>
                    <p className="text-sm text-accent-700 mt-1">{item.ircTitle}</p>
                    {item.notes && (
                      <p className="text-sm text-accent-600 mt-2 italic">{item.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button className="p-1.5 hover:bg-accent-200 rounded-lg transition-colors" title="Confirm">
                      <ThumbsUp className="w-4 h-4 text-accent-600" />
                    </button>
                    <button className="p-1.5 hover:bg-accent-200 rounded-lg transition-colors" title="Reject">
                      <ThumbsDown className="w-4 h-4 text-accent-600" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
