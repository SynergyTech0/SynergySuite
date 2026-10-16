import { useState } from 'react';
import { Building2, CreditCard, Users, Bell, Shield, Database, Sparkles, Save } from 'lucide-react';
import clsx from 'clsx';

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
              <div className="card-body space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                    <input type="text" className="input" defaultValue="Acme Corporation" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Legal Entity Type</label>
                    <select className="input">
                      <option>LLC</option>
                      <option>S-Corporation</option>
                      <option>C-Corporation</option>
                      <option>Partnership</option>
                      <option>Sole Proprietorship</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">EIN / Tax ID</label>
                    <input type="text" className="input" defaultValue="XX-XXXXXXX" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fiscal Year End</label>
                    <select className="input">
                      <option>December 31</option>
                      <option>March 31</option>
                      <option>June 30</option>
                      <option>September 30</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Business Address</label>
                  <input type="text" className="input mb-2" placeholder="Street Address" />
                  <div className="grid grid-cols-3 gap-2">
                    <input type="text" className="input" placeholder="City" />
                    <input type="text" className="input" placeholder="State" />
                    <input type="text" className="input" placeholder="ZIP" />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button className="btn-primary">
                    <Save className="w-4 h-4 mr-2" />
                    Save Changes
                  </button>
                </div>
              </div>
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

          {activeTab === 'users' && (
            <div className="card">
              <div className="card-header flex items-center justify-between">
                <h2 className="text-lg font-semibold">Team Members</h2>
                <button className="btn-primary text-sm">
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
                      <th>Last Active</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    <tr>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                            <span className="text-xs font-medium text-primary-700">JD</span>
                          </div>
                          <div>
                            <p className="font-medium">John Doe</p>
                            <p className="text-sm text-gray-500">john@acme.com</p>
                          </div>
                        </div>
                      </td>
                      <td><span className="badge bg-purple-100 text-purple-800">Admin</span></td>
                      <td><span className="badge-success">Active</span></td>
                      <td className="text-gray-500">Just now</td>
                    </tr>
                    <tr>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                            <span className="text-xs font-medium text-green-700">JS</span>
                          </div>
                          <div>
                            <p className="font-medium">Jane Smith</p>
                            <p className="text-sm text-gray-500">jane@acme.com</p>
                          </div>
                        </div>
                      </td>
                      <td><span className="badge bg-blue-100 text-blue-800">Accountant</span></td>
                      <td><span className="badge-success">Active</span></td>
                      <td className="text-gray-500">2 hours ago</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
