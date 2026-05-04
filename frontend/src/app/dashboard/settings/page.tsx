'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dropdownsApi, /* settingsApi, */ usersApi } from '../../../lib/api';
import { usePermissions } from '../../../lib/rbac';
import {
  ChevronDown, ChevronRight, Eye, EyeOff, Loader2,
  Pencil, Trash2, Users, Settings2, Target, Search, /* LayoutList, */
} from 'lucide-react';
import toast from 'react-hot-toast';

type MainTab = 'users' | 'dropdowns'; // | 'thresholds';
type DropdownSubTab = 'lead_discovery' | 'leads';
type DiscoverySubTab = 'resource' | 'product';

const SHARED_DISCOVERY_CATEGORIES = [
  { key: 'industry',                  label: 'Industry / Vertical' },
  { key: 'company_size',              label: 'Company Size' },
  { key: 'company_type',              label: 'Company Type' },
  { key: 'decision_maker',            label: 'Decision Maker' },
  { key: 'preferred_contact_channel', label: 'Preferred Contact Channel' },
  { key: 'seniority_level',           label: 'Seniority Level' },
];

const PRODUCT_ONLY_CATEGORIES = [
  { key: 'annual_revenue_range', label: 'Annual Revenue Range' },
];

const RESOURCE_DISCOVERY_CATEGORIES = [
  { key: 'resource_industry',                  label: 'Industry / Vertical' },
  { key: 'resource_company_size',              label: 'Company Size' },
  { key: 'resource_company_type',              label: 'Company Type' },
  { key: 'resource_decision_maker',            label: 'Decision Maker (Who Approves Hiring)' },
  { key: 'resource_preferred_contact_channel', label: 'Preferred Contact Channel' },
  { key: 'resource_seniority_level',           label: 'Seniority Level' },
];

const PRODUCT_DISCOVERY_CATEGORIES = [
  { key: 'product_industry',                  label: 'Industry / Vertical' },
  { key: 'product_company_size',              label: 'Company Size' },
  { key: 'product_company_type',              label: 'Company Type' },
  { key: 'product_annual_revenue_range',      label: 'Annual Revenue Range' },
  { key: 'product_decision_maker',            label: 'Decision Maker (Who Makes Buying Decision)' },
  { key: 'product_preferred_contact_channel', label: 'Preferred Contact Channel' },
  { key: 'product_seniority_level',           label: 'Seniority Level' },
];

const LEADS_CATEGORIES = [
  { key: 'lead_status',    label: 'Lead Status' },
  { key: 'lead_source',    label: 'Lead Source' },
  { key: 'job_title',      label: 'Job Title' },
  { key: 'pipeline_stage', label: 'Pipeline Stage' },
  { key: 'loss_reason',    label: 'Loss Reason' },
];

function getCategoryValues(data: any[], categoryKey: string) {
  return (Array.isArray(data) ? data : [])
    .filter((item: any) => item.category === categoryKey)
    .sort((a: any, b: any) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
    });
}

function CategoryAccordion({
  cat, dropdownsData, openCategory, setOpenCategory,
  editingId, setEditingId, editingValue, setEditingValue,
  deletingId, setDeletingId, newValues, setNewValues,
  addMutation, editMutation, toggleMutation, deleteMutation,
}: any) {
  const items = getCategoryValues(dropdownsData, cat.key);
  const isOpen = openCategory === cat.key;
  const activeCount = items.filter((i: any) => i.isActive).length;
  const disabledCount = items.filter((i: any) => !i.isActive).length;

  return (
    <div className="border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden mb-2">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors text-left bg-white dark:bg-transparent"
        onClick={() => setOpenCategory(isOpen ? null : cat.key)}
      >
        <div className="flex items-center gap-2.5">
          {isOpen ? <ChevronDown size={13} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={13} className="text-slate-400 flex-shrink-0" />}
          <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{cat.label}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {activeCount > 0 && <span className="bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-medium">{activeCount} active</span>}
          {disabledCount > 0 && <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full">{disabledCount} disabled</span>}
          {activeCount === 0 && disabledCount === 0 && <span className="text-slate-400">No values</span>}
        </div>
      </button>

      {isOpen && (
        <div className="px-4 pb-4 pt-2 border-t border-slate-100 dark:border-white/[0.04] bg-slate-50/50 dark:bg-slate-900/30">
          <div className="space-y-1.5">
            {items.map((item: any) => (
              <div key={item.id} className="flex items-center justify-between bg-white dark:bg-slate-900/50 rounded-lg px-3 py-2 border border-slate-100 dark:border-white/[0.04]">
                {editingId === item.id ? (
                  <>
                    <input className="input flex-1 h-8 text-sm mr-2" value={editingValue} placeholder="Edit value..."
                      onChange={(e) => setEditingValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { const v = editingValue.trim(); if (!v || !editingId) return; editMutation.mutate({ id: editingId, value: v }); }
                        if (e.key === 'Escape') { setEditingId(null); setEditingValue(''); }
                      }} autoFocus />
                    <button className="text-xs text-green-600 hover:text-green-500 px-2 font-medium"
                      onClick={() => { const v = editingValue.trim(); if (!v) return; editMutation.mutate({ id: editingId, value: v }); }}
                      disabled={editMutation.isPending}>Save</button>
                    <button className="text-xs text-slate-400 hover:text-slate-300 px-2" onClick={() => { setEditingId(null); setEditingValue(''); }}>Cancel</button>
                  </>
                ) : deletingId === item.id ? (
                  <>
                    <span className="text-sm text-slate-600 dark:text-slate-300 flex-1">Are you sure?</span>
                    <button className="text-xs text-red-500 hover:text-red-400 px-2 font-semibold"
                      onClick={() => { if (!item.id) return; deleteMutation.mutate(item.id); }}
                      disabled={deleteMutation.isPending}>Yes, Delete</button>
                    <button className="text-xs text-slate-400 hover:text-slate-300 px-2" onClick={() => setDeletingId(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span className={`text-sm flex-1 min-w-0 truncate pr-2 ${!item.isActive ? 'opacity-50 line-through text-gray-400' : 'text-slate-700 dark:text-slate-300'}`}>
                      {item.value}
                    </span>
                    <div className="flex items-center gap-1">
                      <button aria-label="Edit" className="p-1.5 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-500/20 active:scale-95 transition-all"
                        onClick={() => { setEditingId(item.id); setEditingValue(item.value); }}><Pencil size={13} /></button>
                      <button title={item.isActive ? 'Disable' : 'Enable'}
                        className={`p-1.5 rounded-lg transition-all active:scale-95 ${item.isActive ? 'text-slate-400 hover:text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-500/20' : 'text-emerald-500 hover:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'}`}
                        onClick={() => { if (!item.id) return; toggleMutation.mutate({ id: item.id, isActive: item.isActive }); }}>
                        {item.isActive ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                      <button aria-label="Delete" className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-100 dark:hover:bg-red-500/20 active:scale-95 transition-all"
                        onClick={() => setDeletingId(item.id)}><Trash2 size={13} /></button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {items.length === 0 && <p className="text-xs text-slate-500 py-1">No values yet. Add one below or click <strong>Seed Defaults</strong>.</p>}
            <div className="flex gap-2 pt-1">
              <input className="input flex-1 h-9 text-sm" value={newValues[cat.key] || ''}
                onChange={(e) => setNewValues((prev: any) => ({ ...prev, [cat.key]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { const val = (newValues[cat.key] || '').trim(); if (!val) return; addMutation.mutate({ category: cat.key, value: val, displayOrder: items.length }); }
                }}
                placeholder="Add new value..." />
              <button className="btn-primary text-sm px-4" disabled={addMutation.isPending}
                onClick={() => { const val = (newValues[cat.key] || '').trim(); if (!val) return; addMutation.mutate({ category: cat.key, value: val, displayOrder: items.length }); }}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const permissions = usePermissions();
  const qc = useQueryClient();

  const [mainTab, setMainTab] = useState<MainTab>('users');
  const [dropdownSubTab, setDropdownSubTab] = useState<DropdownSubTab>('lead_discovery');
  const [discoverySubTab, setDiscoverySubTab] = useState<DiscoverySubTab>('resource');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({ fromUserId: '', toUserId: '' });
  const [newValues, setNewValues] = useState<Record<string, string>>({});
  // const [thresholds, setThresholds] = useState({ followUpAlertThresholdDays: 3, stuckDealThresholdDays: 7 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  const { data: usersData } = useQuery({
    queryKey: ['settings-users'],
    queryFn: () => usersApi.list().then((r) => r.data?.data ?? r.data ?? []),
    enabled: permissions.canAccessSettings,
  });

  // const { data: settingsData } = useQuery({
  //   queryKey: ['settings-values'],
  //   queryFn: () => settingsApi.get().then((r) => r.data?.data ?? r.data ?? {}),
  //   enabled: permissions.canAccessSettings,
  // });

  // useEffect(() => {
  //   if (!settingsData) return;
  //   setThresholds({
  //     followUpAlertThresholdDays: Number((settingsData as any).followUpAlertThresholdDays ?? 3),
  //     stuckDealThresholdDays: Number((settingsData as any).stuckDealThresholdDays ?? 7),
  //   });
  // }, [settingsData]);

  const { data: dropdownsData } = useQuery({
    queryKey: ['settings-dropdowns'],
    queryFn: () => dropdownsApi.listAll().then((r) => {
      const raw = r.data?.data ?? r.data ?? {};
      if (Array.isArray(raw)) return raw;
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
  const allDropdowns: any[] = Array.isArray(dropdownsData) ? dropdownsData : [];

  const updateUserMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => usersApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings-users'] }); toast.success('User updated'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to update user'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => usersApi.deactivate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings-users'] }); toast.success('User deactivated'); },
    onError: () => toast.error('Failed to deactivate user'),
  });

  const bulkReassignMutation = useMutation({
    mutationFn: (payload: { fromUserId: string; toUserId: string }) => usersApi.bulkReassignLeads(payload),
    onSuccess: () => { toast.success('Leads reassigned successfully'); setBulkOpen(false); setBulkForm({ fromUserId: '', toUserId: '' }); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to reassign leads'),
  });

  const invalidateDropdowns = () => {
    qc.invalidateQueries({ queryKey: ['settings-dropdowns'] });
    qc.invalidateQueries({ queryKey: ['dropdowns'] });
  };

  const addMutation = useMutation({
    mutationFn: ({ category, value, displayOrder }: { category: string; value: string; displayOrder: number }) => dropdownsApi.add({ category, value, displayOrder }),
    onSuccess: (_: any, v: any) => { invalidateDropdowns(); setNewValues((p) => ({ ...p, [v.category]: '' })); toast.success('Value added'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to add value'),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => dropdownsApi.update(id, { value }),
    onSuccess: () => { invalidateDropdowns(); setEditingId(null); setEditingValue(''); toast.success('Value updated'); },
    onError: (e: any) => { toast.error(e?.response?.data?.message || 'Failed to update value'); setEditingId(null); setEditingValue(''); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => dropdownsApi.update(id, { isActive: !isActive }),
    onSuccess: (_: any, v: any) => { invalidateDropdowns(); toast.success(v.isActive ? 'Value disabled' : 'Value enabled'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update value'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => dropdownsApi.delete(id),
    onSuccess: () => { invalidateDropdowns(); setDeletingId(null); toast.success('Value deleted'); },
    onError: (e: any) => { toast.error(e?.response?.data?.message || 'Failed to delete value'); setDeletingId(null); },
  });

  const seedMutation = useMutation({
    mutationFn: () => dropdownsApi.seed(),
    onSuccess: () => { invalidateDropdowns(); toast.success('Default values seeded successfully'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to seed defaults'),
  });

  // const saveThresholdMutation = useMutation({
  //   mutationFn: (payload: any) => settingsApi.update(payload),
  //   onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings-values'] }); toast.success('Thresholds saved'); },
  //   onError: () => toast.error('Failed to save thresholds'),
  // });

  if (!permissions.canAccessSettings) {
    return (
      <div className="card p-6">
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Unauthorized</h1>
        <p className="text-sm text-slate-500 mt-1">You do not have access to settings.</p>
      </div>
    );
  }

  const accordionProps = {
    dropdownsData: allDropdowns, openCategory, setOpenCategory,
    editingId, setEditingId, editingValue, setEditingValue,
    deletingId, setDeletingId, newValues, setNewValues,
    addMutation, editMutation, toggleMutation, deleteMutation,
  };

  const discoveryCategories = discoverySubTab === 'product'
    ? PRODUCT_DISCOVERY_CATEGORIES
    : RESOURCE_DISCOVERY_CATEGORIES;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">System administration and configuration</p>
      </div>

      {/* ── Main Tab Bar ── */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/60 rounded-xl w-fit">
        {([
          { id: 'users' as MainTab, label: 'User Management', icon: Users },
          ...(permissions.isAdmin ? [{ id: 'dropdowns' as MainTab, label: 'Dropdown Config', icon: Settings2 }] : []),
          // { id: 'thresholds' as MainTab, label: 'Thresholds', icon: LayoutList },
        ] as { id: MainTab; label: string; icon: any }[]).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setMainTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              mainTab === id
                ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {/* ══ USER MANAGEMENT ══ */}
      {mainTab === 'users' && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-white/[0.06]">
            <h2 className="section-title">User Management</h2>
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
                      <select className="input h-11 text-xs" title="User role" value={u.role}
                        onChange={(e) => updateUserMutation.mutate({ id: u.id, data: { role: e.target.value } })}>
                        <option value="sales_user">Sales Executive</option>
                        <option value="manager">Sales Manager</option>
                        <option value="org_admin">Admin</option>
                        <option value="super_admin">Super Admin</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <button className="btn-ghost text-xs"
                        onClick={() => updateUserMutation.mutate({ id: u.id, data: { isActive: !u.isActive } })}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}</td>
                    <td className="px-4 py-3">
                      <button
                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${u.isActive
                          ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-500/20 dark:text-green-400 dark:hover:bg-green-500/30'
                          : 'bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-500/20 dark:text-red-400 dark:hover:bg-red-500/30'}`}
                        onClick={() => {
                          if (u.isActive) { if (window.confirm('Deactivate this user?')) deactivateMutation.mutate(u.id); }
                          else updateUserMutation.mutate({ id: u.id, data: { isActive: true } });
                        }}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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

          {/* Sub-tab: Lead Discovery vs Leads */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/60 rounded-xl w-fit">
            <button onClick={() => setDropdownSubTab('lead_discovery')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                dropdownSubTab === 'lead_discovery'
                  ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}>
              <Target size={13} />Lead Discovery
            </button>
            <button onClick={() => setDropdownSubTab('leads')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                dropdownSubTab === 'leads'
                  ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}>
              <Search size={13} />Leads
            </button>
          </div>

          {/* LEAD DISCOVERY section */}
          {dropdownSubTab === 'lead_discovery' && (
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-white/[0.06]">
                <h2 className="section-title">Lead Discovery Dropdowns</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Manage dropdown values for the Lead Discovery Engine. Each mode (Resource / Product) is configured independently.
                </p>
              </div>
              <div className="px-5 pt-4 pb-5">
                {/* Resource / Product mode toggle */}
                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/60 rounded-xl w-fit mb-3">
                  <button onClick={() => { setDiscoverySubTab('resource'); setOpenCategory(null); }}
                    className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      discoverySubTab === 'resource'
                        ? 'bg-blue-500 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}>
                    Find Clients for Our Resources
                  </button>
                  <button onClick={() => { setDiscoverySubTab('product'); setOpenCategory(null); }}
                    className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      discoverySubTab === 'product'
                        ? 'bg-violet-500 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}>
                    Find Customers for Our Product
                  </button>
                </div>

                {/* Context note */}
                <div className={`rounded-lg px-3 py-2 mb-4 text-xs border ${
                  discoverySubTab === 'resource'
                    ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20 text-blue-700 dark:text-blue-400'
                    : 'bg-violet-50 dark:bg-violet-500/10 border-violet-200 dark:border-violet-500/20 text-violet-700 dark:text-violet-400'
                }`}>
                  {discoverySubTab === 'resource'
                    ? '📋 These dropdown values appear in the "Find Clients for Our Resources" mode only.'
                    : '🛍️ These dropdown values appear in the "Find Customers for Our Product" mode.'}
                </div>

                {discoveryCategories.map((cat) => (
                  <CategoryAccordion key={cat.key} cat={cat} {...accordionProps} />
                ))}
              </div>
            </div>
          )}

          {/* LEADS section */}
          {dropdownSubTab === 'leads' && (
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-white/[0.06]">
                <h2 className="section-title">Leads Module Dropdowns</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Manage dropdown values used across the Leads, Opportunities, and Activities modules.
                </p>
              </div>
              <div className="px-5 pt-4 pb-5">
                {/* <div className="rounded-lg px-3 py-2 mb-4 text-xs border bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400">
                  🗂️ These values control lead statuses, sources, job titles, pipeline stages, and loss reasons throughout the Leads module.
                </div> */}
                {LEADS_CATEGORIES.map((cat) => (
                  <CategoryAccordion key={cat.key} cat={cat} {...accordionProps} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ THRESHOLDS (commented out) ══ */}
      {/* {mainTab === 'thresholds' && (
        <div className="card p-5">
          <h2 className="section-title mb-4">System Thresholds</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="label mb-1.5 block">Follow-up Alert Threshold (days)</label>
              <input type="number" className="input" title="Follow-up alert threshold"
                value={thresholds.followUpAlertThresholdDays}
                onChange={(e) => setThresholds((p) => ({ ...p, followUpAlertThresholdDays: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="label mb-1.5 block">Stuck Deal Threshold (days)</label>
              <input type="number" className="input" title="Stuck deal threshold"
                value={thresholds.stuckDealThresholdDays}
                onChange={(e) => setThresholds((p) => ({ ...p, stuckDealThresholdDays: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <button className="btn-primary" onClick={() => saveThresholdMutation.mutate(thresholds)} disabled={saveThresholdMutation.isPending}>
              {saveThresholdMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
              Save Thresholds
            </button>
          </div>
        </div>
      )} */}

      {/* Bulk Reassign Modal */}
      {bulkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 w-full max-w-md">
            <h3 className="section-title mb-3">Bulk Reassign Leads</h3>
            <div className="space-y-3">
              <div>
                <label className="label mb-1 block">From User</label>
                <select className="input" title="From user" value={bulkForm.fromUserId} onChange={(e) => setBulkForm((p) => ({ ...p, fromUserId: e.target.value }))}>
                  <option value="">Select user</option>
                  {users.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label mb-1 block">To User</label>
                <select className="input" title="To user" value={bulkForm.toUserId} onChange={(e) => setBulkForm((p) => ({ ...p, toUserId: e.target.value }))}>
                  <option value="">Select user</option>
                  {users.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button className="btn-ghost flex-1" onClick={() => setBulkOpen(false)}>Cancel</button>
              <button className="btn-primary flex-1" disabled={bulkReassignMutation.isPending}
                onClick={() => {
                  if (!bulkForm.fromUserId || !bulkForm.toUserId) { toast.error('Both users are required'); return; }
                  bulkReassignMutation.mutate(bulkForm);
                }}>
                Reassign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}