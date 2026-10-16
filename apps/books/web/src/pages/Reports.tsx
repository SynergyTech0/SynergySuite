import { useState } from 'react';
import { FileText, Download, Calendar, TrendingUp, DollarSign, Scale, BookOpen, PieChart } from 'lucide-react';

const reportCategories = [
  {
    name: 'Financial Statements',
    reports: [
      { id: 'balance-sheet', name: 'Balance Sheet', description: 'Assets, liabilities, and equity at a point in time', icon: Scale },
      { id: 'income-statement', name: 'Income Statement', description: 'Revenue and expenses over a period', icon: TrendingUp },
      { id: 'cash-flow', name: 'Cash Flow Statement', description: 'Cash inflows and outflows', icon: DollarSign },
    ],
  },
  {
    name: 'General Ledger',
    reports: [
      { id: 'trial-balance', name: 'Trial Balance', description: 'Summary of all account balances', icon: Scale },
      { id: 'general-ledger', name: 'General Ledger', description: 'Detailed transaction history by account', icon: BookOpen },
      { id: 'journal-report', name: 'Journal Report', description: 'All journal entries for a period', icon: FileText },
    ],
  },
  {
    name: 'Receivables & Payables',
    reports: [
      { id: 'ar-aging', name: 'A/R Aging Summary', description: 'Outstanding customer invoices by age', icon: Calendar },
      { id: 'ap-aging', name: 'A/P Aging Summary', description: 'Outstanding vendor bills by age', icon: Calendar },
      { id: 'customer-balance', name: 'Customer Balance Detail', description: 'Detailed receivables by customer', icon: FileText },
    ],
  },
  {
    name: 'Tax Reports',
    reports: [
      { id: 'tax-classification', name: 'Tax Classification Report', description: 'AI-generated tax categorizations with IRC citations', icon: PieChart },
      { id: '1099-summary', name: '1099 Summary', description: 'Payments to 1099 vendors', icon: FileText },
      { id: 'deduction-summary', name: 'Deduction Summary', description: 'Tax-deductible expenses by category', icon: DollarSign },
    ],
  },
];

export function Reports() {
  const [selectedPeriod, setSelectedPeriod] = useState('this-month');

  const periods = [
    { id: 'this-month', name: 'This Month' },
    { id: 'last-month', name: 'Last Month' },
    { id: 'this-quarter', name: 'This Quarter' },
    { id: 'this-year', name: 'This Year' },
    { id: 'custom', name: 'Custom' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 mt-1">Financial reports and tax documentation</p>
        </div>
        <div className="flex items-center gap-4">
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className="input"
          >
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-8">
        {reportCategories.map((category) => (
          <div key={category.name}>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{category.name}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {category.reports.map((report) => {
                const Icon = report.icon;
                return (
                  <div
                    key={report.id}
                    className="card hover:shadow-md transition-shadow cursor-pointer group"
                  >
                    <div className="card-body">
                      <div className="flex items-start justify-between">
                        <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                          <Icon className="w-5 h-5 text-primary-600" />
                        </div>
                        <button className="opacity-0 group-hover:opacity-100 transition-opacity btn-secondary text-xs py-1 px-2">
                          <Download className="w-3 h-3 mr-1" />
                          Export
                        </button>
                      </div>
                      <div className="mt-4">
                        <h3 className="font-semibold text-gray-900">{report.name}</h3>
                        <p className="text-sm text-gray-500 mt-1">{report.description}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="card bg-gradient-to-r from-accent-50 to-primary-50">
        <div className="card-body">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm">
              <PieChart className="w-6 h-6 text-accent-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900">AI Tax Classification Report</h3>
              <p className="text-sm text-gray-600 mt-1">
                Generate a comprehensive report of all transactions with AI-powered tax classifications,
                IRC citations, and confidence scores.
              </p>
            </div>
            <button className="btn-primary">
              Generate Report
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
