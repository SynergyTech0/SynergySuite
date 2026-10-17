import { useState } from 'react';
import { Search, Sparkles, CheckCircle, AlertCircle, Clock, BookOpen, ThumbsUp, ThumbsDown, RefreshCw, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useTaxClassifications, categoryLabel } from '../hooks/useTaxClassification';
import type { TaxClassificationRecord } from '../hooks/useTaxClassification';
import { num } from '../hooks/useOrgList';
import { formatMoney, formatDate } from '../lib/format';

/** Below this confidence a classification is flagged for a person to look at. */
const REVIEW_THRESHOLD = 0.8;

/** CONFIRMED when a person set it, NEEDS_REVIEW when the AI was unsure, otherwise CLASSIFIED. */
function statusOf(c: TaxClassificationRecord): string {
  if (c.isManualOverride) return 'CONFIRMED';
  return c.confidence < REVIEW_THRESHOLD ? 'NEEDS_REVIEW' : 'CLASSIFIED';
}

export function TaxClassification() {
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const historyQ = useTaxClassifications();

  const all = (historyQ.data ?? []).map((c) => {
    const line = c.journalLine;
    const debit = num(line?.debit);
    const credit = num(line?.credit);
    const citation = c.citations?.find((x) => x.section) ?? null;
    return {
      id: c.id,
      transaction: line?.description || line?.journal?.description || line?.account?.name || 'Journal line',
      // Revenue lines are credits (money in); expense lines are debits (money out).
      amount: credit > 0 ? credit : -debit,
      date: line?.journal?.journalDate ?? c.classifiedAt ?? c.createdAt,
      category: categoryLabel(c.category),
      ircCode: c.ircSection || citation?.section || null,
      ircTitle: citation?.citationText || citation?.regulation || null,
      confidence: c.confidence,
      status: statusOf(c),
      notes: c.explanation,
    };
  });
  const q = search.trim().toLowerCase();
  const classifications = all
    .filter((c) => statusFilter === 'ALL' || c.status === statusFilter)
    .filter((c) => !q || c.transaction.toLowerCase().includes(q) || c.category.toLowerCase().includes(q));
  const avgConfidence = all.length ? all.reduce((sum, c) => sum + c.confidence, 0) / all.length : null;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'CONFIRMED':
        return <span className="badge-success"><CheckCircle className="w-3 h-3 mr-1" />Confirmed</span>;
      case 'CLASSIFIED':
        return <span className="badge-info"><Clock className="w-3 h-3 mr-1" />Classified</span>;
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
              <p className="stat-value text-lg">{avgConfidence === null ? '-' : `${Math.round(avgConfidence * 100)}%`}</p>
              <p className="text-xs text-gray-500">Average Confidence</p>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <p className="stat-value text-lg">{all.filter((c) => c.status === 'CONFIRMED').length}</p>
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
              <p className="stat-value text-lg">{all.filter((c) => c.status === 'CLASSIFIED').length}</p>
              <p className="text-xs text-gray-500">Classified by AI</p>
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
              <AlertCircle className="w-4 h-4 text-red-600" />
            </div>
            <div>
              <p className="stat-value text-lg">{all.filter((c) => c.status === 'NEEDS_REVIEW').length}</p>
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
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              {['ALL', 'CONFIRMED', 'CLASSIFIED', 'NEEDS_REVIEW'].map((status) => (
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
          {historyQ.isLoading && (
            <div className="p-8 text-center text-sm text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
              Loading…
            </div>
          )}
          {historyQ.isError && (
            <div className="p-8 text-center text-sm text-red-600">
              {(historyQ.error as Error).message || 'Classifications could not be loaded.'}
            </div>
          )}
          {historyQ.isSuccess && classifications.length === 0 && (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-gray-700">
                {all.length === 0 ? 'No transactions have been classified yet' : 'No classifications match this filter'}
              </p>
              {all.length === 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  Classified journal lines appear here with their tax category, IRC citation and confidence.
                </p>
              )}
            </div>
          )}
          {classifications.map((item) => (
            <div key={item.id} className="p-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-gray-900">{item.transaction}</span>
                    {getStatusBadge(item.status)}
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                    <span>{formatDate(item.date)}</span>
                    <span className={item.amount >= 0 ? 'text-green-600 font-mono' : 'text-red-600 font-mono'}>
                      {item.amount >= 0 ? '+' : '-'}{formatMoney(Math.abs(item.amount))}
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
                      {item.ircCode && (
                        <span className="badge bg-accent-200 text-accent-900 text-xs">{item.ircCode}</span>
                      )}
                    </div>
                    {item.ircTitle && <p className="text-sm text-accent-700 mt-1">{item.ircTitle}</p>}
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
