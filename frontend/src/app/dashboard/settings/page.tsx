'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dropdownsApi, settingsApi, usersApi } from '../../../lib/api';
import { usePermissions } from '../../../lib/rbac';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const permissions = usePermissions();
  const qc = useQueryClient();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({ fromUserId: '', toUserId: '' });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    lead_source: true,
    industry: false,
    budget_range: false,
    pipeline_stage: false,
    business_line: false,
    loss_reason: false,
    company_size: false,
    company_type: false,
    decision_maker: false,
    preferred_contact_channel: false,
    seniority_level: false,
    annual_revenue_range: false,
  });
  const [newValues, setNewValues] = useState<Record<string, string>>({});
  const [thresholds, setThresholds] = useState({
    followUpAlertThresholdDays: 3,
    stuckDealThresholdDays: 7,
  });

  const { data: usersData } = useQuery({
    queryKey: ['settings-users'],
    queryFn: () => usersApi.list().then((r) => r.data?.data ?? r.data ?? []),
    enabled: permissions.canAccessSettings,
  });

  const { data: settingsData } = useQuery({
    queryKey: ['settings-values'],
    queryFn: () => settingsApi.get().then((r) => r.data?.data ?? r.data ?? {}),
    enabled: permissions.canAccessSettings,
  });

  useEffect(() => {
    if (!settingsData) return;
    setThresholds({
      followUpAlertThresholdDays: Number((settingsData as any).followUpAlertThresholdDays ?? 3),
      stuckDealThresholdDays: Number((settingsData as any).stuckDealThresholdDays ?? 7),
    });
  }, [settingsData]);

  const { data: dropdownsData } = useQuery({
    queryKey: ['settings-dropdowns'],
    queryFn: () => dropdownsApi.listAll().then((r) => r.data?.data ?? r.data ?? {}),
    enabled: permissions.canAccessSettings && permissions.isAdmin,
  });

  const users = Array.isArray(usersData) ? usersData : [];

  const categories = [
    // CRM dropdowns
    { key: 'lead_source',  label: 'Lead Source',  group: 'CRM' },
    { key: 'industry',     label: 'Industry',     group: 'CRM' },
    { key: 'budget_range', label: 'Budget Range', group: 'CRM' },
    { key: 'pipeline_stage', label: 'Pipeline Stages', group: 'CRM' },
    { key: 'business_line',  label: 'Business Lines',  group: 'CRM' },
    { key: 'loss_reason',    label: 'Loss Reasons',    group: 'CRM' },
    // Discovery scan dropdowns
    { key: 'company_size',               label: 'Company Size',          group: 'Discovery' },
    { key: 'company_type',               label: 'Company Type',          group: 'Discovery' },
    { key: 'decision_maker',             label: 'Decision Makers',       group: 'Discovery' },
    { key: 'preferred_contact_channel',  label: 'Contact Channels',      group: 'Discovery' },
    { key: 'seniority_level',            label: 'Seniority Levels',      group: 'Discovery' },
    { key: 'annual_revenue_range',       label: 'Annual Revenue Range',  group: 'Discovery' },
  ];

  const categoryValues = (category: string) => {
    if (!dropdownsData) return [];
    if (Array.isArray(dropdownsData)) {
      return dropdownsData.filter((item: any) => item.category === category);
    }
    const fromKey = dropdownsData[category];
    if (Array.isArray(fromKey)) return fromKey;
    return [];
  };

  const updateUserMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => usersApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings-users'] });
      toast.success('User updated');
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Failed to update user'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => usersApi.deactivate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings-users'] });
      toast.success('User deactivated');
    },
    onError: () => toast.error('Failed to deactivate user'),
  });

  const bulkReassignMutation = useMutation({
    mutationFn: (payload: { fromUserId: string; toUserId: string }) => usersApi.bulkReassignLeads(payload),
    onSuccess: () => {
      toast.success('Leads reassigned successfully');
      setBulkOpen(false);
      setBulkForm({ fromUserId: '', toUserId: '' });
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Failed to reassign leads'),
  });

  // Helper: invalidate both the settings cache AND the lead-discovery cache together
  const invalidateDropdowns = () => {
    qc.invalidateQueries({ queryKey: ['settings-dropdowns'] });
    qc.invalidateQueries({ queryKey: ['dropdowns', 'active'] });
  };

  const addDropdownMutation = useMutation({
    mutationFn: ({ category, value }: { category: string; value: string }) => dropdownsApi.add({ category, value }),
    onSuccess: () => { invalidateDropdowns(); toast.success('Value added'); },
    onError: () => toast.error('Failed to add value'),
  });

  const disableDropdownMutation = useMutation({
    mutationFn: (id: string) => dropdownsApi.update(id, { isActive: false }),
    onSuccess: () => { invalidateDropdowns(); toast.success('Value disabled'); },
    onError: () => toast.error('Failed to disable value'),
  });

  const enableDropdownMutation = useMutation({
    mutationFn: (id: string) => dropdownsApi.update(id, { isActive: true }),
    onSuccess: () => { invalidateDropdowns(); toast.success('Value enabled'); },
    onError: () => toast.error('Failed to enable value'),
  });

  const deleteDropdownMutation = useMutation({
    mutationFn: (id: string) => dropdownsApi.delete(id),
    onSuccess: () => { invalidateDropdowns(); toast.success('Value deleted'); },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to delete value'),
  });

  const saveThresholdMutation = useMutation({
    mutationFn: (payload: any) => settingsApi.update(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings-values'] });
      toast.success('Thresholds saved');
    },
    onError: () => toast.error('Failed to save thresholds'),
  });

  if (!permissions.canAccessSettings) {
    return (
      <div className="card p-6">
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Unauthorized</h1>
        <p className="text-sm text-slate-500 mt-1">You do not have access to settings.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">System administration and configuration</p>
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/[0.06] flex items-center justify-between">
          <h2 className="section-title">User Management</h2>
          {/* <button className="btn-ghost" onClick={() => setBulkOpen(true)}>Bulk Reassign Leads</button> */}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 dark:border-white/[0.06]">
                {['Name', 'Email', 'Role', 'Status', 'Last Login', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u: any) => (
                <tr key={u.id} className="border-b border-slate-200 dark:border-white/[0.04]">
                  <td className="px-4 py-3 text-sm text-slate-800 dark:text-slate-200">{u.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-400">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      className="input h-11 text-xs"
                      title="User role"
                      value={u.role}
                      onChange={(e) => updateUserMutation.mutate({ id: u.id, data: { role: e.target.value } })}
                    >
                      <option value="sales_user">Sales Executive</option>
                      <option value="manager">Sales Manager</option>
                      <option value="org_admin">Admin</option>
                      <option value="super_admin">Super Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      className="btn-ghost text-xs"
                      onClick={() => updateUserMutation.mutate({ id: u.id, data: { isActive: !u.isActive } })}
                    >
                      {u.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-400">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}</td>
                  <td className="px-4 py-3">
                    <button
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                        u.isActive
                          ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-500/20 dark:text-green-400 dark:hover:bg-green-500/30'
                          : 'bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-500/20 dark:text-red-400 dark:hover:bg-red-500/30'
                      }`}
                      onClick={() => {
                        if (u.isActive) {
                          if (window.confirm('Deactivate this user?')) {
                            deactivateMutation.mutate(u.id);
                          }
                        } else {
                          updateUserMutation.mutate({ id: u.id, data: { isActive: true } });
                        }
                      }}
                    >
                      {u.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {permissions.isAdmin && (
        <div className="card p-5 space-y-4">
          <div>
            <h2 className="section-title">Dropdown Configuration</h2>
            <p className="text-xs text-slate-500 mt-0.5">Manage selectable values for CRM and Lead Discovery. Changes apply to all users in your workspace.</p>
          </div>

          {['CRM', 'Discovery'].map(group => (
            <div key={group}>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">{group} Dropdowns</p>
              <div className="space-y-2">
                {categories.filter(c => c.group === group).map((cat) => {
                  const allValues = categoryValues(cat.key);
                  const activeValues = allValues.filter((i: any) => i.isActive !== false);
                  const inactiveValues = allValues.filter((i: any) => i.isActive === false);
                  return (
                    <div key={cat.key} className="border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
                      <button
                        className="w-full px-4 py-2.5 flex items-center justify-between bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        onClick={() => setExpanded((prev) => ({ ...prev, [cat.key]: !prev[cat.key] }))}
                      >
                        <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                          {cat.label}
                          <span className="ml-2 text-xs text-slate-400 font-normal">{activeValues.length} active</span>
                        </span>
                        {expanded[cat.key] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      {expanded[cat.key] && (
                        <div className="p-3 space-y-2">
                          {activeValues.map((item: any) => (
                            <div key={item.id || item.value} className="flex items-center justify-between bg-slate-50 dark:bg-slate-900/50 rounded-lg px-3 py-2">
                              <span className="text-sm text-slate-700 dark:text-slate-300">{item.value}</span>
                              <div className="flex gap-1.5">
                                <button
                                  className="text-xs px-2 py-1 rounded-md text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors"
                                  onClick={() => disableDropdownMutation.mutate(item.id)}
                                >
                                  Disable
                                </button>
                                <button
                                  className="text-xs px-2 py-1 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                                  onClick={() => {
                                    if (window.confirm(`Delete "${item.value}"?`)) deleteDropdownMutation.mutate(item.id);
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))}
                          {inactiveValues.length > 0 && (
                            <details className="mt-1">
                              <summary className="text-xs text-slate-400 cursor-pointer select-none">{inactiveValues.length} disabled</summary>
                              <div className="mt-1.5 space-y-1">
                                {inactiveValues.map((item: any) => (
                                  <div key={item.id} className="flex items-center justify-between bg-slate-100 dark:bg-slate-800/40 rounded-lg px-3 py-1.5 opacity-60">
                                    <span className="text-sm text-slate-500 line-through">{item.value}</span>
                                    <button
                                      className="text-xs px-2 py-1 rounded-md text-green-600 hover:bg-green-50 dark:hover:bg-green-500/10 transition-colors"
                                      onClick={() => enableDropdownMutation.mutate(item.id)}
                                    >
                                      Enable
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                          {allValues.length === 0 && (
                            <p className="text-xs text-slate-500 py-1">No values configured. Add one below.</p>
                          )}
                          <div className="flex gap-2 pt-1">
                            <input
                              className="input flex-1 h-9 text-sm"
                              value={newValues[cat.key] || ''}
                              onChange={(e) => setNewValues((prev) => ({ ...prev, [cat.key]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const val = (newValues[cat.key] || '').trim();
                                  if (!val) return;
                                  addDropdownMutation.mutate({ category: cat.key, value: val });
                                  setNewValues((prev) => ({ ...prev, [cat.key]: '' }));
                                }
                              }}
                              placeholder="Add new value…"
                            />
                            <button
                              className="btn-primary text-sm px-4"
                              disabled={addDropdownMutation.isPending}
                              onClick={() => {
                                const val = (newValues[cat.key] || '').trim();
                                if (!val) return;
                                addDropdownMutation.mutate({ category: cat.key, value: val });
                                setNewValues((prev) => ({ ...prev, [cat.key]: '' }));
                              }}
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card p-5">
        <h2 className="section-title mb-4">System Thresholds</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label mb-1.5 block">Follow-up Alert Threshold (days)</label>
            <input
              type="number"
              className="input"
              title="Follow-up alert threshold"
              value={thresholds.followUpAlertThresholdDays}
              onChange={(e) => setThresholds((prev) => ({ ...prev, followUpAlertThresholdDays: Number(e.target.value) }))}
            />
          </div>
          <div>
            <label className="label mb-1.5 block">Stuck Deal Threshold (days)</label>
            <input
              type="number"
              className="input"
              title="Stuck deal threshold"
              value={thresholds.stuckDealThresholdDays}
              onChange={(e) => setThresholds((prev) => ({ ...prev, stuckDealThresholdDays: Number(e.target.value) }))}
            />
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <button
            className="btn-primary"
            onClick={() => saveThresholdMutation.mutate(thresholds)}
            disabled={saveThresholdMutation.isPending}
          >
            {saveThresholdMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            Save Thresholds
          </button>
        </div>
      </div>

      {bulkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 w-full max-w-md">
            <h3 className="section-title mb-3">Bulk Reassign Leads</h3>
            <div className="space-y-3">
              <div>
                <label className="label mb-1 block">From User</label>
                <select className="input" title="From user" value={bulkForm.fromUserId} onChange={(e) => setBulkForm((prev) => ({ ...prev, fromUserId: e.target.value }))}>
                  <option value="">Select user</option>
                  {users.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label mb-1 block">To User</label>
                <select className="input" title="To user" value={bulkForm.toUserId} onChange={(e) => setBulkForm((prev) => ({ ...prev, toUserId: e.target.value }))}>
                  <option value="">Select user</option>
                  {users.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button className="btn-ghost flex-1" onClick={() => setBulkOpen(false)}>Cancel</button>
              <button
                className="btn-primary flex-1"
                disabled={bulkReassignMutation.isPending}
                onClick={() => {
                  if (!bulkForm.fromUserId || !bulkForm.toUserId) {
                    toast.error('Both users are required');
                    return;
                  }
                  bulkReassignMutation.mutate(bulkForm);
                }}
              >
                Reassign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
