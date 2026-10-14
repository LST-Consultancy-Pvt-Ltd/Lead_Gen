'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dropdownsApi, /* settingsApi, */ usersApi, emailTemplatesApi } from '../../../lib/api';
import { usePermissions } from '../../../lib/rbac';
import {
  ChevronDown, ChevronRight, Eye, EyeOff, Loader2,
  Pencil, Trash2, Users, Settings2, Target, Search, Mail, /* LayoutList, */
  Star, Plus, ListChecks, Briefcase, Package, Info, Clock, Power, FileText, Shuffle, Palette,
} from 'lucide-react';
import { ThemePickerCards } from '../../../components/common/ThemePicker';
import { getTheme } from '../../../lib/themes';
import { useThemeStore } from '../../../store/themeStore';
import { PageHero } from '../../../components/ui/PageHero';
import { Avatar } from '../../../components/ui';
import { getInitials } from '../../../lib/utils';
import toast from 'react-hot-toast';
import { Select } from '../../../components/ui/Select';

type MainTab = 'users' | 'dropdowns' | 'email_templates' | 'appearance'; // | 'thresholds';
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

// Only categories the Leads form actually uses. Job Title, Pipeline Stage, Loss Reason and
// Opportunity Business Line were removed from Settings because no page reads them
// (their stored values in the database are left untouched).
const LEADS_CATEGORIES = [
  { key: 'lead_status',               label: 'Lead Status' },
  { key: 'lead_source',               label: 'Lead Source' },
  { key: 'lead_type',                 label: 'Lead Type' },
  { key: 'industry',                  label: 'Industry' },
  { key: 'location',                  label: 'Location' },
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
  addMutation, editMutation, toggleMutation, deleteMutation, setDefaultMutation,
}: any) {
  const items = getCategoryValues(dropdownsData, cat.key);
  const isOpen = openCategory === cat.key;
  const activeCount = items.filter((i: any) => i.isActive).length;
  const disabledCount = items.filter((i: any) => !i.isActive).length;

  return (
    <div className={`rounded-xl overflow-hidden mb-2.5 border transition-all ${isOpen ? 'border-blue-200 dark:border-blue-500/25 shadow-md shadow-blue-500/5' : 'border-line hover:border-slate-300 dark:hover:border-white/[0.14]'}`}>
      <button
        type="button"
        aria-expanded={isOpen}
        className={`w-full flex items-center justify-between gap-3 px-4 py-3 transition-colors text-left ${isOpen ? 'bg-gradient-to-r from-blue-50/80 to-transparent dark:from-blue-500/[0.07]' : 'bg-white dark:bg-surface hover:bg-slate-50 dark:hover:bg-white/[0.02]'}`}
        onClick={() => setOpenCategory(isOpen ? null : cat.key)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${isOpen ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/30' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'}`}>
            <ListChecks size={15} />
          </span>
          <span className="text-sm font-semibold text-ink truncate">{cat.label}</span>
        </div>
        <div className="flex items-center gap-2 text-xs flex-shrink-0">
          {activeCount > 0 && <span className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-md font-semibold">{activeCount} active</span>}
          {disabledCount > 0 && <span className="bg-slate-400/10 text-ink-3 px-2 py-0.5 rounded-md font-semibold">{disabledCount} disabled</span>}
          {activeCount === 0 && disabledCount === 0 && <span className="text-ink-3">No values</span>}
          <ChevronDown size={15} className={`text-ink-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isOpen && (
        <div className="px-4 pb-4 pt-3 border-t border-slate-100 dark:border-white/[0.05] bg-slate-50/60 dark:bg-white/[0.015]">
          <div className="space-y-1.5">
            {items.map((item: any) => (
              <div key={item.id} className="group flex items-center justify-between bg-white dark:bg-surface-2 rounded-lg px-3 py-2 border border-line hover:border-slate-300 dark:hover:border-white/[0.12] transition-colors">
                {editingId === item.id ? (
                  <>
                    <input className="input flex-1 h-8 text-sm mr-2" value={editingValue} placeholder="Edit value..."
                      onChange={(e) => setEditingValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { const v = editingValue.trim(); if (!v || !editingId) return; editMutation.mutate({ id: editingId, value: v }); }
                        if (e.key === 'Escape') { setEditingId(null); setEditingValue(''); }
                      }} autoFocus />
                    <button className="text-xs font-semibold h-7 px-2.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 mr-1"
                      onClick={() => { const v = editingValue.trim(); if (!v) return; editMutation.mutate({ id: editingId, value: v }); }}
                      disabled={editMutation.isPending}>Save</button>
                    <button className="text-xs font-medium h-7 px-2.5 rounded-md text-ink-3 hover:bg-slate-100 dark:hover:bg-white/[0.05]" onClick={() => { setEditingId(null); setEditingValue(''); }}>Cancel</button>
                  </>
                ) : deletingId === item.id ? (
                  <>
                    <span className="text-sm font-medium text-rose-700 dark:text-rose-300 flex-1">Are you sure?</span>
                    <button className="text-xs font-semibold h-7 px-2.5 rounded-md bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 mr-1"
                      onClick={() => { if (!item.id) return; deleteMutation.mutate(item.id); }}
                      disabled={deleteMutation.isPending}>Yes, Delete</button>
                    <button className="text-xs font-medium h-7 px-2.5 rounded-md text-ink-3 hover:bg-slate-100 dark:hover:bg-white/[0.05]" onClick={() => setDeletingId(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span className={`text-sm flex-1 min-w-0 truncate pr-2 ${!item.isActive ? 'opacity-50 line-through text-ink-3' : 'font-medium text-ink dark:text-slate-200'}`}>
                      {item.value}
                    </span>
                    {item.isDefault && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 bg-amber-500/10 rounded-md px-2 py-0.5 mr-2"><Star size={10} className="fill-current" /> Default</span>
                    )}
                    <div className="flex items-center gap-1">
                      <button
                        title={item.isDefault ? 'Already default' : 'Set as default'}
                        className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all active:scale-95 ${item.isDefault ? 'text-amber-500 cursor-default' : 'text-slate-400 hover:text-amber-500 hover:bg-amber-500/10'}`}
                        onClick={() => { if (!item.isDefault && item.id) setDefaultMutation.mutate(item.id); }}
                        disabled={item.isDefault || setDefaultMutation.isPending}
                      ><Star size={13} className={item.isDefault ? 'fill-current' : ''} /></button>
                      <button aria-label="Edit" className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-500/10 active:scale-95 transition-all"
                        onClick={() => { setEditingId(item.id); setEditingValue(item.value); }}><Pencil size={13} /></button>
                      <button title={item.isActive ? 'Disable' : 'Enable'}
                        className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all active:scale-95 ${item.isActive ? 'text-slate-400 hover:text-orange-500 hover:bg-orange-500/10' : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'}`}
                        onClick={() => { if (!item.id) return; toggleMutation.mutate({ id: item.id, isActive: item.isActive }); }}>
                        {item.isActive ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                      <button aria-label="Delete" className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 active:scale-95 transition-all"
                        onClick={() => setDeletingId(item.id)}><Trash2 size={13} /></button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {items.length === 0 && <p className="text-xs text-ink-3 py-1">No values yet. Add one below or click <strong>Seed Defaults</strong>.</p>}
            <div className="flex gap-2 pt-2">
              <input className="input flex-1 h-10 text-sm" value={newValues[cat.key] || ''}
                onChange={(e) => setNewValues((prev: any) => ({ ...prev, [cat.key]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { const val = (newValues[cat.key] || '').trim(); if (!val) return; addMutation.mutate({ category: cat.key, value: val, displayOrder: items.length }); }
                }}
                placeholder="Add new value..." />
              <button className="btn-primary text-sm px-4 h-10" disabled={addMutation.isPending}
                onClick={() => { const val = (newValues[cat.key] || '').trim(); if (!val) return; addMutation.mutate({ category: cat.key, value: val, displayOrder: items.length }); }}>
                <Plus size={14} /> Add
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
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [templateForm, setTemplateForm] = useState({ name: '', body: '' });
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editTemplateForm, setEditTemplateForm] = useState({ name: '', body: '' });
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

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

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => dropdownsApi.setDefault(id),
    onSuccess: () => { invalidateDropdowns(); toast.success('Default value updated'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update default'),
  });

  const seedMutation = useMutation({
    mutationFn: () => dropdownsApi.seed(),
    onSuccess: () => { invalidateDropdowns(); toast.success('Default values seeded successfully'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to seed defaults'),
  });

  const { data: templatesData } = useQuery({
    queryKey: ['email-templates'],
    queryFn: () => emailTemplatesApi.list().then((r) => r.data?.data ?? r.data ?? []),
    enabled: permissions.canAccessSettings && permissions.isAdmin,
  });
  const templates: any[] = Array.isArray(templatesData) ? templatesData : [];

  const createTemplateMutation = useMutation({
    mutationFn: (data: { name: string; body: string }) => emailTemplatesApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-templates'] });
      setShowAddTemplate(false);
      setTemplateForm({ name: '', body: '' });
      toast.success('Template saved');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to save template'),
  });

  const updateTemplateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; body?: string } }) => emailTemplatesApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-templates'] });
      setEditingTemplateId(null);
      toast.success('Template updated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update template'),
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: (id: string) => emailTemplatesApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['email-templates'] }); toast.success('Template deleted'); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to delete template'),
  });

  // const saveThresholdMutation = useMutation({
  //   mutationFn: (payload: any) => settingsApi.update(payload),
  //   onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings-values'] }); toast.success('Thresholds saved'); },
  //   onError: () => toast.error('Failed to save thresholds'),
  // });

  if (!permissions.canAccessSettings) {
    return (
      <div className="card p-10 flex flex-col items-center text-center gap-3">
        <div className="w-14 h-14 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center">
          <Settings2 size={24} />
        </div>
        <h1 className="font-display text-lg font-semibold text-ink">Unauthorized</h1>
        <p className="text-sm text-ink-3">You do not have access to settings.</p>
      </div>
    );
  }

  const accordionProps = {
    dropdownsData: allDropdowns, openCategory, setOpenCategory,
    editingId, setEditingId, editingValue, setEditingValue,
    deletingId, setDeletingId, newValues, setNewValues,
    addMutation, editMutation, toggleMutation, deleteMutation, setDefaultMutation,
  };

  const discoveryCategories = discoverySubTab === 'product'
    ? PRODUCT_DISCOVERY_CATEGORIES
    : RESOURCE_DISCOVERY_CATEGORIES;

  return (
    <div className="space-y-6">
      <PageHero
        icon={Settings2}
        eyebrow="Administration"
        title="Settings"
        subtitle="System administration and configuration"
      />

      {/* ── Main Tab Bar ── */}
      <div className="card p-1.5 flex flex-wrap items-center gap-1 w-fit max-w-full">
        {([
          { id: 'users' as MainTab, label: 'User Management', icon: Users },
          ...(permissions.isAdmin ? [{ id: 'dropdowns' as MainTab, label: 'Dropdown Config', icon: Settings2 }] : []),
          ...(permissions.isAdmin ? [{ id: 'email_templates' as MainTab, label: 'Email Templates', icon: Mail }] : []),
          { id: 'appearance' as MainTab, label: 'Appearance', icon: Palette },
          // { id: 'thresholds' as MainTab, label: 'Thresholds', icon: LayoutList },
        ] as { id: MainTab; label: string; icon: any }[]).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setMainTab(id)}
            className={`flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-semibold transition-all ${
              mainTab === id
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30'
                : 'text-ink-3 hover:text-ink dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.05]'
            }`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {/* ══ USER MANAGEMENT ══ */}
      {mainTab === 'users' && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-white/[0.06] flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Users size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="section-title">User Management</h2>
              <p className="text-xs text-ink-3 mt-0.5">Change roles and access for everyone in your workspace</p>
            </div>
            <span className="text-xs font-bold tabular-nums px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-300">{users.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="bg-slate-50 dark:bg-surface-2">
                <tr className="border-b border-line">
                  {['Name', 'Email', 'Role', 'Status', 'Last Login', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3.5 text-left text-[11px] font-semibold text-ink-3 uppercase tracking-[0.08em]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u: any) => (
                  <tr key={u.id} className="border-b border-slate-100 dark:border-white/[0.04] hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar initials={getInitials(u.name)} size="sm" />
                        <span className="text-sm font-semibold text-ink whitespace-nowrap">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-3">{u.email}</td>
                    <td className="px-4 py-3">
                      <Select className="input h-9 text-xs min-w-[150px]" title="User role" value={u.role}
                        onChange={(e) => updateUserMutation.mutate({ id: u.id, data: { role: e.target.value } })}>
                        <option value="sales_user">Sales Executive</option>
                        <option value="manager">Sales Manager</option>
                        <option value="org_admin">Admin</option>
                        <option value="super_admin">Super Admin</option>
                      </Select>
                    </td>
                    <td className="px-4 py-3">
                      <button className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs font-semibold transition-colors ${u.isActive ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20' : 'bg-slate-400/10 text-ink-3 hover:bg-slate-400/20'}`}
                        onClick={() => updateUserMutation.mutate({ id: u.id, data: { isActive: !u.isActive } })}>
                        <span className={`w-1.5 h-1.5 rounded-full ${u.isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                        {u.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-3 whitespace-nowrap"><span className="inline-flex items-center gap-1"><Clock size={11} /> {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}</span></td>
                    <td className="px-4 py-3">
                      <button
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold h-7 px-2.5 rounded-lg transition-colors ${u.isActive
                          ? 'bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300'
                          : 'bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:text-rose-300'}`}
                        onClick={() => {
                          if (u.isActive) { if (window.confirm('Deactivate this user?')) deactivateMutation.mutate(u.id); }
                          else updateUserMutation.mutate({ id: u.id, data: { isActive: true } });
                        }}>
                        <Power size={11} /> {u.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {permissions.isAdmin && mainTab === 'dropdowns' && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-white/[0.06] flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 flex items-center justify-center flex-shrink-0">
              <Settings2 size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="section-title">Dropdown Configuration</h2>
              <p className="text-xs text-ink-3 mt-0.5">Click a category to manage its values. Changes apply to all users in your workspace.</p>
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
          <div className="flex items-center gap-1 p-1 m-4 mb-0 bg-slate-100 dark:bg-white/[0.04] rounded-xl w-fit">
            <button onClick={() => setDropdownSubTab('lead_discovery')}
              className={`flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold transition-all ${
                dropdownSubTab === 'lead_discovery'
                  ? 'bg-white dark:bg-surface-2 text-blue-700 dark:text-blue-300 shadow-sm'
                  : 'text-ink-3 hover:text-ink dark:hover:text-white'
              }`}>
              <Target size={13} />Lead Discovery
            </button>
            <button onClick={() => setDropdownSubTab('leads')}
              className={`flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold transition-all ${
                dropdownSubTab === 'leads'
                  ? 'bg-white dark:bg-surface-2 text-blue-700 dark:text-blue-300 shadow-sm'
                  : 'text-ink-3 hover:text-ink dark:hover:text-white'
              }`}>
              <Search size={13} />Leads
            </button>
          </div>

          {/* LEAD DISCOVERY section */}
          {dropdownSubTab === 'lead_discovery' && (
            <div className="m-4 rounded-2xl border border-line overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 dark:border-white/[0.06] bg-slate-50/60 dark:bg-white/[0.02]">
                <h2 className="section-title">Lead Discovery Dropdowns</h2>
                <p className="text-xs text-ink-3 mt-0.5">
                  Manage dropdown values for the Lead Discovery Engine. Each mode (Resource / Product) is configured independently.
                </p>
              </div>
              <div className="px-5 pt-4 pb-5">
                {/* Resource / Product mode toggle */}
                <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-white/[0.04] rounded-xl w-fit mb-3">
                  <button onClick={() => { setDiscoverySubTab('resource'); setOpenCategory(null); }}
                    className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-semibold transition-all ${
                      discoverySubTab === 'resource'
                        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/30'
                        : 'text-ink-3 hover:text-ink dark:hover:text-white'
                    }`}>
                    <Briefcase size={13} /> Find Clients for Our Resources
                  </button>
                  <button onClick={() => { setDiscoverySubTab('product'); setOpenCategory(null); }}
                    className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-semibold transition-all ${
                      discoverySubTab === 'product'
                        ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-md shadow-violet-500/30'
                        : 'text-ink-3 hover:text-ink dark:hover:text-white'
                    }`}>
                    <Package size={13} /> Find Customers for Our Product
                  </button>
                </div>

                {/* Context note */}
                <div className={`flex items-center gap-2 rounded-xl px-3.5 py-2.5 mb-4 text-xs font-medium border ${
                  discoverySubTab === 'resource'
                    ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20 text-blue-700 dark:text-blue-400'
                    : 'bg-violet-50 dark:bg-violet-500/10 border-violet-200 dark:border-violet-500/20 text-violet-700 dark:text-violet-400'
                }`}>
                  <Info size={14} className="flex-shrink-0" />
                  {discoverySubTab === 'resource'
                    ? 'These dropdown values appear in the "Find Clients for Our Resources" mode only.'
                    : 'These dropdown values appear in the "Find Customers for Our Product" mode.'}
                </div>

                {discoveryCategories.map((cat) => (
                  <CategoryAccordion key={cat.key} cat={cat} {...accordionProps} />
                ))}
              </div>
            </div>
          )}

          {/* LEADS section */}
          {dropdownSubTab === 'leads' && (
            <div className="m-4 rounded-2xl border border-line overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 dark:border-white/[0.06] bg-slate-50/60 dark:bg-white/[0.02]">
                <h2 className="section-title">Leads Module Dropdowns</h2>
                <p className="text-xs text-ink-3 mt-0.5">
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

      {/* ══ APPEARANCE ══ */}
      {mainTab === 'appearance' && <AppearancePanel />}

      {/* ══ EMAIL TEMPLATES ══ */}
      {permissions.isAdmin && mainTab === 'email_templates' && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-white/[0.06] flex flex-wrap items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
              <Mail size={18} />
            </div>
            <div className="flex-1 min-w-[200px]">
              <h2 className="section-title">Email Templates</h2>
              <p className="text-xs text-ink-3 mt-0.5">Paste sample outreach emails from your sales team. The AI uses these as style references when generating emails.</p>
            </div>
            <button
              className="btn-primary text-sm flex items-center gap-1.5"
              onClick={() => { setShowAddTemplate(true); setTemplateForm({ name: '', body: '' }); }}>
              <Plus size={14} />Add Template
            </button>
          </div>

          {showAddTemplate && (
            <div className="px-5 py-5 border-b border-slate-100 dark:border-white/[0.06] bg-gradient-to-b from-blue-50/60 to-transparent dark:from-blue-500/[0.05] space-y-4 animate-fade-in">
              <div>
                <label className="label mb-1.5 block">Template Name</label>
                <input
                  className="input"
                  placeholder="e.g. ERP outreach, Short intro, Follow-up"
                  value={templateForm.name}
                  onChange={(e) => setTemplateForm((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label className="label mb-1.5 block">Sample Email Body</label>
                <textarea
                  className="input min-h-[180px] resize-y font-mono text-xs"
                  placeholder="Paste a sample email here. Subject + body is fine. The AI will match its tone and structure but replace product-specific names with your services."
                  value={templateForm.body}
                  onChange={(e) => setTemplateForm((p) => ({ ...p, body: e.target.value }))} />
              </div>
              <div className="flex gap-2 justify-end">
                <button className="btn-ghost text-sm" onClick={() => { setShowAddTemplate(false); setTemplateForm({ name: '', body: '' }); }}>Cancel</button>
                <button
                  className="btn-primary text-sm"
                  disabled={createTemplateMutation.isPending || !templateForm.name.trim() || !templateForm.body.trim()}
                  onClick={() => createTemplateMutation.mutate(templateForm)}>
                  {createTemplateMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
                  Save Template
                </button>
              </div>
            </div>
          )}

          <div className="divide-y divide-slate-100 dark:divide-white/[0.04]">
            {templates.length === 0 && !showAddTemplate && (
              <div className="px-5 py-12 flex flex-col items-center text-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <FileText size={20} />
                </div>
                <p className="text-sm text-ink-3">No templates yet. Add your first sample email above.</p>
              </div>
            )}
            {templates.map((t: any) => (
              <div key={t.id} className="px-5 py-4 hover:bg-slate-50/70 dark:hover:bg-white/[0.015] transition-colors">
                {editingTemplateId === t.id ? (
                  <div className="space-y-3">
                    <input
                      className="input text-sm"
                      value={editTemplateForm.name}
                      onChange={(e) => setEditTemplateForm((p) => ({ ...p, name: e.target.value }))} />
                    <textarea
                      className="input min-h-[160px] resize-y font-mono text-xs"
                      value={editTemplateForm.body}
                      onChange={(e) => setEditTemplateForm((p) => ({ ...p, body: e.target.value }))} />
                    <div className="flex gap-2 justify-end">
                      <button className="btn-ghost text-sm" onClick={() => setEditingTemplateId(null)}>Cancel</button>
                      <button
                        className="btn-primary text-sm"
                        disabled={updateTemplateMutation.isPending || !editTemplateForm.name.trim() || !editTemplateForm.body.trim()}
                        onClick={() => updateTemplateMutation.mutate({ id: t.id, data: editTemplateForm })}>
                        {updateTemplateMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/25 flex items-center justify-center flex-shrink-0">
                        <Mail size={15} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink mb-1">{t.name}</p>
                        <p className="text-xs text-ink-3 font-mono whitespace-pre-wrap line-clamp-3 bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/[0.05] rounded-lg px-3 py-2">{t.body}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {deletingTemplateId === t.id ? (
                        <>
                          <span className="text-xs font-medium text-rose-700 dark:text-rose-300 mr-1">Delete?</span>
                          <button
                            className="text-xs font-semibold h-7 px-2.5 rounded-md bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 transition-colors"
                            disabled={deleteTemplateMutation.isPending}
                            onClick={() => deleteTemplateMutation.mutate(t.id, { onSettled: () => setDeletingTemplateId(null) })}>
                            {deleteTemplateMutation.isPending ? <Loader2 size={10} className="animate-spin" /> : 'Yes'}
                          </button>
                          <button
                            className="text-xs font-medium h-7 px-2.5 rounded-md text-ink-3 hover:bg-slate-100 dark:hover:bg-white/[0.05] transition-colors"
                            onClick={() => setDeletingTemplateId(null)}>
                            No
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="w-8 h-8 flex items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 transition-colors"
                            title="Edit"
                            onClick={() => { setEditingTemplateId(t.id); setEditTemplateForm({ name: t.name, body: t.body }); }}>
                            <Pencil size={13} />
                          </button>
                          <button
                            className="w-8 h-8 flex items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors"
                            title="Delete"
                            onClick={() => setDeletingTemplateId(t.id)}>
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-[2px] p-4 animate-fade-in">
          <div className="relative bg-white dark:bg-surface border border-line rounded-2xl p-6 pt-7 w-full max-w-md shadow-2xl overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500" />
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/30 flex items-center justify-center">
                <Shuffle size={18} />
              </div>
              <h3 className="font-display text-base font-semibold text-ink">Bulk Reassign Leads</h3>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label mb-1.5 block">From User</label>
                <Select className="input" title="From user" value={bulkForm.fromUserId} onChange={(e) => setBulkForm((p) => ({ ...p, fromUserId: e.target.value }))}>
                  <option value="">Select user</option>
                  {users.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
              </div>
              <div>
                <label className="label mb-1.5 block">To User</label>
                <Select className="input" title="To user" value={bulkForm.toUserId} onChange={(e) => setBulkForm((p) => ({ ...p, toUserId: e.target.value }))}>
                  <option value="">Select user</option>
                  {users.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button className="btn-ghost flex-1 justify-center py-2.5" onClick={() => setBulkOpen(false)}>Cancel</button>
              <button className="btn-primary flex-1 justify-center py-2.5" disabled={bulkReassignMutation.isPending}
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
function AppearancePanel() {
  const theme = useThemeStore((s) => s.theme);
  const active = getTheme(theme);
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-line flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/30 flex items-center justify-center flex-shrink-0">
          <Palette size={18} />
        </div>
        <div className="flex-1 min-w-[200px]">
          <h2 className="section-title">Appearance</h2>
          <p className="text-xs text-ink-3 mt-0.5">Choose a theme for the whole app. It applies instantly and is saved on this browser.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs font-semibold bg-blue-500/10 text-blue-700 dark:text-blue-300">
          Active: {active.name}
        </span>
      </div>
      <div className="p-5">
        <ThemePickerCards />
      </div>
    </div>
  );
}
