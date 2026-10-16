import { useState } from 'react';
import { Plus, Briefcase, DollarSign, Loader2, X } from 'lucide-react';
import { PageHeader, StatGrid, StatCard, Card, Toolbar, DataTable, StatusPill } from '../components/ui';
import type { Column } from '../components/ui';
import { formatMoney } from '../lib/format';
import { num, useCreateOrgResource } from '../hooks/useOrgList';
import { useProjects } from '../hooks/useProjects';
import type { Project } from '../hooks/useProjects';

const titleCase = (s?: string | null) =>
  (s || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) || '—';

export function Projects() {
  const { data, isLoading, isError, error } = useProjects();
  const projects = data ?? [];
  const [search, setSearch] = useState('');

  const create = useCreateOrgResource<{ name: string; customerId?: string; status: string; budgetAmount?: number }>('projects');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', budget: '' });

  const filtered = projects.filter(
    (p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.projectNumber.includes(search),
  );
  const activeCount = projects.filter((p) => p.status === 'ACTIVE').length;
  const totalBudget = projects.reduce((s, p) => s + num(p.budgetAmount), 0);

  const submitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      { name: form.name, status: 'ACTIVE', budgetAmount: form.budget ? parseFloat(form.budget) : undefined },
      {
        onSuccess: () => {
          setShowCreate(false);
          setForm({ name: '', budget: '' });
        },
      },
    );
  };

  const columns: Column<Project>[] = [
    { key: 'num', header: 'Project #', render: (p) => <span className="font-mono text-gray-700">{p.projectNumber}</span> },
    { key: 'name', header: 'Name', render: (p) => <span className="font-medium text-primary-600">{p.name}</span> },
    { key: 'customer', header: 'Customer', render: (p) => <span className="text-gray-500">{p.customer?.name ?? '—'}</span> },
    { key: 'billing', header: 'Billing', render: (p) => <span className="text-gray-500">{titleCase(p.billingType)}</span> },
    { key: 'budget', header: 'Budget', align: 'right', render: (p) => <span className="tabular-nums">{formatMoney(num(p.budgetAmount))}</span> },
    { key: 'status', header: 'Status', render: (p) => <StatusPill status={p.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle="Track jobs, budgets, and profitability"
        actions={
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New project
          </button>
        }
      />

      <StatGrid>
        <StatCard label="Total projects" value={String(projects.length)} icon={Briefcase} tone="default" />
        <StatCard label="Active" value={String(activeCount)} icon={Briefcase} tone="success" />
        <StatCard label="Total budget" value={formatMoney(totalBudget)} icon={DollarSign} tone="accent" />
      </StatGrid>

      <Card>
        <Toolbar search={search} onSearch={setSearch} placeholder="Search projects…" />
        {isLoading ? (
          <div className="px-4 py-12 text-center text-sm text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
            Loading projects…
          </div>
        ) : isError ? (
          <div className="px-4 py-12 text-center text-sm text-red-500">
            {(error as Error)?.message || 'Failed to load projects.'}
          </div>
        ) : (
          <DataTable columns={columns} rows={filtered} rowKey={(p) => p.id} emptyMessage="No projects yet." />
        )}
      </Card>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <form onSubmit={submitCreate} className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">New project</h2>
              <button type="button" onClick={() => setShowCreate(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="label">Project name</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
              </div>
              <div>
                <label className="label">Budget</label>
                <input type="number" className="input" placeholder="0.00" step="0.01" min="0" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
              </div>
              {create.isError && (
                <p className="text-sm text-red-600">{(create.error as Error)?.message || 'Could not create project.'}</p>
              )}
            </div>
            <div className="p-4 border-t bg-gray-50 rounded-b-xl flex gap-2">
              <button type="submit" disabled={create.isPending || !form.name} className="flex-1 btn-primary">
                {create.isPending ? 'Saving…' : 'Create project'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="flex-1 btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
