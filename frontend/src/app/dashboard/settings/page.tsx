'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dropdownsApi, settingsApi, usersApi } from '../../../lib/api';
import { usePermissions } from '../../../lib/rbac';
import { ChevronDown, ChevronRight, Eye, EyeOff, Loader2, Pencil, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const permissions = usePermissions();
  const qc = useQueryClient();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({ fromUserId: '', toUserId: '' });
  const [newValues, setNewValues] = useState<Record<string, string>>({});
  const [thresholds, setThresholds] = useState({
    followUpAlertThresholdDays: 3,
    stuckDealThresholdDays: 7,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openCategory, setOpenCategory] = useState<string | null>(null);

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
    queryFn: () => dropdownsApi.listAll().then((r) => {
      const raw = r.data?.data ?? r.data ?? {};
      if (Array.isArray(raw)) return raw;
      // API returns grouped object { category: [...items] } — flatten to a single array
      return (Object.values(raw) as any[]).flat();
    }),
    enabled: permissions.canAccessSettings && permissions.isAdmin,
  });

  useEffect(() => {
    if (
      permissions.canAccessSettings &&
      permissions.isAdmin &&
      Array.isArray(dropdownsData) &&
      dropdownsData.length === 0
    ) {
      dropdownsApi.seed();
    }
  }, [dropdownsData, permissions.canAccessSettings, permissions.isAdmin]);

  const users = Array.isArray(usersData) ? usersData : [];

  const categories = [
    { key: 'lead_status',               label: 'Lead Status' },
    { key: 'lead_source',               label: 'Lead Source' },
    { key: 'job_title',                 label: 'Job Title' },
    { key: 'pipeline_stage',            label: 'Pipeline Stage' },
    { key: 'loss_reason',               label: 'Loss Reason' },
    { key: 'industry',                  label: 'Target Industry' },
    { key: 'company_size',              label: 'Company Size' },
    { key: 'company_type',              label: 'Company Type' },
    { key: 'decision_maker',            label: 'Decision Maker' },
    { key: 'preferred_contact_channel', label: 'Preferred Contact Channel' },
    { key: 'seniority_level',           label: 'Seniority Level' },
    { key: 'annual_revenue_range',      label: 'Annual Revenue Range' },
  ];

  function getCategoryValues(data: any, categoryKey: string) {
    const arr = Array.isArray(data) ? data : [];
    return arr
      .filter((item: any) => item.category === categoryKey)
      .sort((a: any, b: any) => {
        // Active items first, disabled items last — both groups sorted by displayOrder
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
      });
  }

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

  const invalidateDropdowns = () => {
    qc.invalidateQueries({ queryKey: ['settings-dropdowns'] });
    qc.invalidateQueries({ queryKey: ['dropdowns'] });
  };

  const addMutation = useMutation({
    mutationFn: ({ category, value, displayOrder }: { category: string; value: string; displayOrder: number }) =>
      dropdownsApi.add({ category, value, displayOrder }),
    onSuccess: (_data: any, variables: { category: string; value: string; displayOrder: number }) => {
      invalidateDropdowns();
      setNewValues((prev) => ({ ...prev, [variables.category]: '' }));
      toast.success('Value added');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to add value'),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => dropdownsApi.update(id, { value }),
    onSuccess: () => {
      invalidateDropdowns();
      setEditingId(null);
      setEditingValue('');
      toast.success('Value updated');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to update value');
      setEditingId(null);
      setEditingValue('');
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      dropdownsApi.update(id, { isActive: !isActive }),
    onSuccess: (_data: any, variables: { id: string; isActive: boolean }) => {
      invalidateDropdowns();
      toast.success(variables.isActive ? 'Value disabled' : 'Value enabled');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update value'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => dropdownsApi.delete(id),
    onSuccess: () => {
      invalidateDropdowns();
      setDeletingId(null);
      toast.success('Value deleted');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to delete value');
      setDeletingId(null);
    },
  });

  const seedMutation = useMutation({
    mutationFn: () => dropdownsApi.seed(),
    onSuccess: () => {
      invalidateDropdowns();
      toast.success('Default values seeded successfully');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to seed defaults'),
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
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-white/[0.06] flex items-center justify-between">
            <div>
              <h2 className="section-title">Dropdown Configuration</h2>
              <p className="text-xs text-slate-500 mt-0.5">Click a category to manage its values. Changes apply to all users in your workspace.</p>
            </div>
            {/* Seed Defaults button removed — auto-seeded on load
            <button
              className="btn-ghost text-xs flex items-center gap-1.5 flex-shrink-0"
              onClick={() => seedMutation.mutate()}
              disabled={seedMutation.isPending}
              title="Populate all categories with factory default values (safe to run multiple times)"
            >
              {seedMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
              Seed Defaults
            </button>
            */}
          </div>

          <div className="divide-y divide-slate-200 dark:divide-white/[0.06]">
            {categories.map((cat) => {
              const items = getCategoryValues(dropdownsData, cat.key);
              const isOpen = openCategory === cat.key;
              const activeCount = items.filter((i: any) => i.isActive).length;
              const disabledCount = items.filter((i: any) => !i.isActive).length;
              return (
                <div key={cat.key}>
                  {/* Accordion header */}
                  <button
                    type="button"
                    className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors text-left"
                    onClick={() => setOpenCategory(isOpen ? null : cat.key)}
                  >
                    <div className="flex items-center gap-3">
                      {isOpen
                        ? <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
                        : <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />}
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{cat.label}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {activeCount > 0 && (
                        <span className="bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-medium">
                          {activeCount} active
                        </span>
                      )}
                      {disabledCount > 0 && (
                        <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full">
                          {disabledCount} disabled
                        </span>
                      )}
                      {activeCount === 0 && disabledCount === 0 && (
                        <span className="text-slate-400">No values</span>
                      )}
                    </div>
                  </button>

                  {/* Accordion body */}
                  {isOpen && (
                  <div className="px-5 pb-4 pt-1 border-t border-slate-100 dark:border-white/[0.04] bg-slate-50/50 dark:bg-slate-900/30">
                  <div className="space-y-1.5">
                    {items.map((item: any) => (
                      <div key={item.id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-900/50 rounded-lg px-3 py-2 group/row">
                        {editingId === item.id ? (
                          <>
                            <input
                              className="input flex-1 h-8 text-sm mr-2"
                              value={editingValue}
                              placeholder="Edit value..."
                              onChange={(e) => setEditingValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const v = editingValue.trim();
                                  if (!v) return;
                                  if (!editingId) { toast.error('This value has no database ID — please run the seed script'); return; }
                                  editMutation.mutate({ id: editingId, value: v });
                                }
                                if (e.key === 'Escape') { setEditingId(null); setEditingValue(''); }
                              }}
                              autoFocus
                            />
                            <button
                              className="text-xs text-green-600 hover:text-green-500 px-2 font-medium"
                              onClick={() => {
                                const v = editingValue.trim();
                                if (!v) return;
                                if (!editingId) { toast.error('This value has no database ID — please run the seed script'); return; }
                                editMutation.mutate({ id: editingId, value: v });
                              }}
                              disabled={editMutation.isPending}
                            >
                              Save
                            </button>
                            <button
                              className="text-xs text-slate-400 hover:text-slate-300 px-2"
                              onClick={() => { setEditingId(null); setEditingValue(''); }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : deletingId === item.id ? (
                          <>
                            <span className="text-sm text-slate-600 dark:text-slate-300 flex-1">Are you sure?</span>
                            <button
                              className="text-xs text-red-500 hover:text-red-400 px-2 font-semibold"
                              onClick={() => {
                                if (!item.id) { toast.error('This value has no database ID — please run the seed script'); return; }
                                deleteMutation.mutate(item.id);
                              }}
                              disabled={deleteMutation.isPending}
                            >
                              Yes, Delete
                            </button>
                            <button
                              className="text-xs text-slate-400 hover:text-slate-300 px-2"
                              onClick={() => setDeletingId(null)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <span className={`text-sm flex-1 min-w-0 truncate pr-2 ${
                              !item.isActive
                                ? 'opacity-50 line-through text-gray-400'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}>
                              {item.value}
                            </span>
                            <div className="flex items-center gap-1">
                              {/* Edit */}
                              <button
                                aria-label="Edit"
                                title="Edit"
                                className="p-2 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-500/20 active:scale-95 transition-all"
                                onClick={() => { setEditingId(item.id); setEditingValue(item.value); }}
                              >
                                <Pencil size={14} />
                              </button>
                              {/* Disable / Enable */}
                              <button
                                title={item.isActive ? 'Disable' : 'Enable'}
                                className={`p-2 rounded-lg transition-all active:scale-95 ${
                                  item.isActive
                                    ? 'text-slate-400 hover:text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-500/20'
                                    : 'text-emerald-500 hover:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
                                }`}
                                onClick={() => {
                                  if (!item.id) { toast.error('This value has no database ID — please run the seed script'); return; }
                                  toggleMutation.mutate({ id: item.id, isActive: item.isActive });
                                }}
                              >
                                {item.isActive ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                              {/* Delete */}
                              <button
                                aria-label="Delete"
                                title="Delete"
                                className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-100 dark:hover:bg-red-500/20 active:scale-95 transition-all"
                                onClick={() => setDeletingId(item.id)}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                    {items.length === 0 && (
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
                            addMutation.mutate({ category: cat.key, value: val, displayOrder: items.length });
                          }
                        }}
                        placeholder="Add new value..."
                      />
                      <button
                        className="btn-primary text-sm px-4"
                        disabled={addMutation.isPending}
                        onClick={() => {
                          const val = (newValues[cat.key] || '').trim();
                          if (!val) return;
                          addMutation.mutate({ category: cat.key, value: val, displayOrder: items.length });
                        }}
                      >
                        Add
                      </button>
                    </div>
                  </div>
                  </div>
                  )}
                </div>
              );
            })}
          </div>
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
