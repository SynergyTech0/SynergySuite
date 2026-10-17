import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, CreditCard, Users, Bell, Shield, Database, Sparkles, Save, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useOrganization, useUpdateOrganization } from '../hooks/useOrganization';
import { useCompanies, useMembers } from '../hooks/usePlanning';
import { useAuth } from '../stores/authStore';
import { initials } from '../lib/format';

const ENTITY_TYPES = [
  { value: 'LLC', label: 'LLC' },
  { value: 'S_CORP', label: 'S-Corporation' },
  { value: 'C_CORP', label: 'C-Corporation' },
  { value: 'PARTNERSHIP', label: 'Partnership' },
  { value: 'SOLE_PROPRIETORSHIP', label: 'Sole Proprietorship' },
  { value: 'NON_PROFIT', label: 'Non-profit' },
  { value: 'TRUST', label: 'Trust' },
  { value: 'ESTATE', label: 'Estate' },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Company details from the organization record, saved back with PUT /organizations/:id. */
function CompanyForm() {
  const org = useOrganization();
  const save = useUpdateOrganization();
  const [form, setForm] = useState({ name: '', entityType: 'LLC', taxId: '', fiscalYearEnd: 12 });

  useEffect(() => {
    if (org.data) {
      setForm({
        name: org.data.name ?? '',
        entityType: org.data.entityType ?? 'LLC',
        taxId: org.data.taxId ?? '',
        fiscalYearEnd: Number(org.data.fiscalYearEnd) || 12,
      });
    }
  }, [org.data]);

  if (org.isLoading) {
    return (
      <div className="card-body text-center text-sm text-gray-400 py-12">
        <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
        Loading…
      </div>
    );
  }
  if (org.isError) {
    return <div className="card-body text-sm text-red-600">{(org.error as Error).message || 'Company details could not be loaded.'}</div>;
  }

  return (
    <form
      className="card-body space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          name: form.name.trim(),
          entityType: form.entityType,
          fiscalYearEnd: form.fiscalYearEnd,
          ...(form.taxId.trim() ? { ein: form.taxId.trim() } : {}),
        });
      }}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
          <input type="text" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Legal Entity Type</label>
          <select className="input" value={form.entityType} onChange={(e) => setForm({ ...form, entityType: e.target.value })}>
            {ENTITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">EIN / Tax ID</label>
          <input
            type="text"
            className="input"
            placeholder="XX-XXXXXXX"
            value={form.taxId}
            onChange={(e) => setForm({ ...form, taxId: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Fiscal Year End</label>
          <select
            className="input"
            value={form.fiscalYearEnd}
            onChange={(e) => setForm({ ...form, fiscalYearEnd: Number(e.target.value) })}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m} {new Date(2001, i + 1, 0).getDate()}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center justify-end gap-3">
        {save.isSuccess && <span className="text-sm text-green-700">Saved.</span>}
        {save.isError && <span className="text-sm text-red-600">{(save.error as Error).message || 'Could not save.'}</span>}
        <button className="btn-primary" disabled={save.isPending}>
          {save.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Save Changes
        </button>
      </div>
    </form>
  );
}

/** People with access to the current company. */
function TeamMembers() {
  const navigate = useNavigate();
  const { data: companies } = useCompanies();
  const current = companies?.find((c) => c.current);
  const members = useMembers(current?.id);
  const me = useAuth((s) => s.user?.id);

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <h2 className="text-lg font-semibold">Team Members</h2>
        <button className="btn-primary text-sm" onClick={() => navigate('/consolidation')}>
          <Users className="w-4 h-4 mr-2" />
          Invite User
        </button>
      </div>
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {(members.isLoading || !current) && (
              <tr>
                <td colSpan={3} className="text-center text-gray-400 py-8">
                  <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
                  Loading…
                </td>
              </tr>
            )}
            {members.isError && (
              <tr>
                <td colSpan={3} className="text-center text-red-600 py-8">
                  {(members.error as Error).message || 'Team members could not be loaded.'}
                </td>
              </tr>
            )}
            {(members.data ?? []).map((m) => (
              <tr key={m.userId}>
                <td>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                      <span className="text-xs font-medium text-primary-700">{initials(m.name || m.email)}</span>
                    </div>
                    <div>
                      <p className="font-medium">
                        {m.name || m.email}
                        {m.userId === me && <span className="text-gray-400 font-normal"> (you)</span>}
                      </p>
                      <p className="text-sm text-gray-500">{m.email}</p>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="badge bg-purple-100 text-purple-800">
                    {m.role.charAt(0) + m.role.slice(1).toLowerCase()}
                  </span>
                </td>
                <td>
                  {m.active ? <span className="badge-success">Active</span> : <span className="badge bg-gray-100 text-gray-600">Inactive</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const tabs = [
  { id: 'company', name: 'Company', icon: Building2 },
  { id: 'billing', name: 'Billing', icon: CreditCard },
  { id: 'users', name: 'Users', icon: Users },
  { id: 'notifications', name: 'Notifications', icon: Bell },
  { id: 'security', name: 'Security', icon: Shield },
  { id: 'integrations', name: 'Integrations', icon: Database },
  { id: 'ai', name: 'AI Settings', icon: Sparkles },
];

export function Settings() {
  const [activeTab, setActiveTab] = useState('company');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Manage your organization settings and preferences</p>
      </div>

      <div className="flex gap-6">
        <div className="w-56 flex-shrink-0">
          <nav className="space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={clsx(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                    activeTab === tab.id
                      ? 'bg-primary-100 text-primary-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-100'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {tab.name}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex-1">
          {activeTab === 'company' && (
            <div className="card">
              <div className="card-header">
                <h2 className="text-lg font-semibold">Company Information</h2>
              </div>
              <CompanyForm />
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-6">
              <div className="card">
                <div className="card-header">
                  <h2 className="text-lg font-semibold">AI Tax Classification Settings</h2>
                </div>
                <div className="card-body space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Classification Confidence Threshold</label>
                    <p className="text-sm text-gray-500 mb-2">Transactions below this threshold will be flagged for manual review</p>
                    <select className="input max-w-xs">
                      <option value="0.9">90% (Strict)</option>
                      <option value="0.8">80% (Balanced)</option>
                      <option value="0.7">70% (Permissive)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Auto-Classification</label>
                    <p className="text-sm text-gray-500 mb-2">Automatically classify new transactions as they're imported</p>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" id="auto-classify" className="rounded border-gray-300 text-primary-600" defaultChecked />
                      <label htmlFor="auto-classify" className="text-sm text-gray-700">Enable auto-classification</label>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">IRC Citation Style</label>
                    <select className="input max-w-xs">
                      <option>Full Citation (IRC §XXX(a)(1))</option>
                      <option>Short Citation (§XXX)</option>
                      <option>Descriptive (Section Name)</option>
                    </select>
                  </div>
                  <div className="flex justify-end">
                    <button className="btn-primary">
                      <Save className="w-4 h-4 mr-2" />
                      Save Changes
                    </button>
                  </div>
                </div>
              </div>

              <div className="card bg-gradient-to-r from-accent-50 to-purple-50">
                <div className="card-body">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm">
                      <Sparkles className="w-6 h-6 text-accent-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900">AI Model Training</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Train the AI model on your confirmed classifications to improve accuracy for your specific business.
                      </p>
                    </div>
                    <button className="btn-secondary">
                      Start Training
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'users' && <TeamMembers />}

          {activeTab !== 'company' && activeTab !== 'ai' && activeTab !== 'users' && (
            <div className="card">
              <div className="card-body text-center py-12">
                <p className="text-gray-500">Settings for {tabs.find(t => t.id === activeTab)?.name} coming soon...</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
