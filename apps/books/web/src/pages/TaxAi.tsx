import { useState } from 'react';
import { Sparkles, Scale, Loader2, BookOpen } from 'lucide-react';
import { PageHeader, Card } from '../components/ui';
import { useTaxAiStatus, useTaxAsk, useTaxAnalyze } from '../hooks/useTaxAi';
import type { TaxAnswer } from '../hooks/useTaxAi';

const EXAMPLES = [
  'Can I deduct a client dinner, and how much?',
  'I bought a $60,000 SUV for the business — how much can I write off this year?',
  'Are home office expenses deductible for an S-corp owner?',
  'Is my new laptop a §179 expense or do I depreciate it?',
];

function AnswerBlock({ result }: { result: TaxAnswer }) {
  return (
    <div className="space-y-4">
      <div className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-800">{result.answer}</div>
      {result.citations?.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
          <span className="text-xs text-gray-400 mr-1 self-center">Grounded in:</span>
          {result.citations.map((c) => (
            <span key={c.section} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-accent-50 text-accent-800 text-xs" title={c.title || ''}>
              <BookOpen className="w-3 h-3" />§{c.section}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function TaxAi() {
  const status = useTaxAiStatus();
  const [tab, setTab] = useState<'ask' | 'analyze'>('ask');

  const ask = useTaxAsk();
  const [question, setQuestion] = useState('');

  const analyze = useTaxAnalyze();
  const [expense, setExpense] = useState({ description: '', amount: '', category: '' });

  const active = tab === 'ask' ? ask : analyze;

  return (
    <div>
      <PageHeader
        title="Tax AI"
        subtitle="Write-off guidance grounded in the actual Internal Revenue Code"
        actions={
          status.data ? (
            <span className="inline-flex items-center gap-2 text-xs text-gray-500">
              <Scale className="w-4 h-4 text-accent-600" />
              {status.data.ircSections.toLocaleString()} IRC sections · {status.data.model}
              {!status.data.configured && <span className="text-amber-600">· API key needed</span>}
            </span>
          ) : null
        }
      />

      <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden mb-4">
        {(['ask', 'analyze'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize ${tab === t ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            {t === 'ask' ? 'Ask a question' : 'Analyze an expense'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <div className="p-4 space-y-3">
              {tab === 'ask' ? (
                <>
                  <label className="label">Your tax question</label>
                  <textarea
                    className="input min-h-[110px]"
                    placeholder="e.g. Can I deduct mileage and meals for a business trip?"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                  />
                  <button className="btn-primary w-full" disabled={ask.isPending || !question.trim()} onClick={() => ask.mutate(question)}>
                    {ask.isPending ? <Loader2 className="w-4 h-4 animate-spin inline" /> : <><Sparkles className="w-4 h-4 mr-2 inline" />Ask</>}
                  </button>
                  <div className="pt-1 space-y-1">
                    <p className="text-xs text-gray-400">Try:</p>
                    {EXAMPLES.map((ex) => (
                      <button key={ex} onClick={() => setQuestion(ex)} className="block text-left text-xs text-primary-600 hover:text-primary-700">
                        {ex}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <label className="label">Expense description</label>
                  <input className="input" placeholder="Client dinner at Nobu" value={expense.description} onChange={(e) => setExpense({ ...expense, description: e.target.value })} />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Amount</label>
                      <input type="number" className="input" placeholder="0.00" value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Category (optional)</label>
                      <input className="input" placeholder="Meals" value={expense.category} onChange={(e) => setExpense({ ...expense, category: e.target.value })} />
                    </div>
                  </div>
                  <button
                    className="btn-primary w-full"
                    disabled={analyze.isPending || !expense.description.trim()}
                    onClick={() => analyze.mutate({ description: expense.description, amount: expense.amount ? parseFloat(expense.amount) : undefined, category: expense.category || undefined })}
                  >
                    {analyze.isPending ? <Loader2 className="w-4 h-4 animate-spin inline" /> : <><Scale className="w-4 h-4 mr-2 inline" />Analyze deductibility</>}
                  </button>
                </>
              )}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Card>
            <div className="p-5 min-h-[220px]">
              {active.isPending ? (
                <div className="text-center text-sm text-gray-400 py-16">
                  <Loader2 className="w-6 h-6 animate-spin inline mb-2" />
                  <p>Consulting the Internal Revenue Code…</p>
                </div>
              ) : active.isError ? (
                <div className="text-center py-16">
                  <p className="text-sm text-red-600">{(active.error as Error)?.message || 'Something went wrong.'}</p>
                  <p className="text-xs text-gray-400 mt-2">If this says the AI is unavailable, ask your administrator to set an AI model for the suite.</p>
                </div>
              ) : active.data ? (
                <AnswerBlock result={active.data as TaxAnswer} />
              ) : (
                <div className="text-center text-sm text-gray-400 py-16">
                  <Sparkles className="w-8 h-8 mx-auto mb-3 text-gray-300" />
                  <p>Ask a question or analyze an expense.</p>
                  <p className="text-xs mt-1">Answers cite the exact IRC § they rely on.</p>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
