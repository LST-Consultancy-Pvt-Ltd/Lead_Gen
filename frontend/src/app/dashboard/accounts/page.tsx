'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountsApi } from '../../../lib/api';
import { usePermissions } from '../../../lib/rbac';
import { Spinner, EmptyState } from '../../../components/ui';
import { PageHero } from '../../../components/ui/PageHero';
import { KpiCard } from '../../../components/dashboards/DashboardUI';
import { formatDate } from '../../../lib/utils';
import { Building2, Plus, Search, Pencil, Trash2, X, BadgeCheck, Target, Handshake, CalendarDays } from 'lucide-react';
import toast from 'react-hot-toast';
import { Select } from '../../../components/ui/Select';

const CUSTOMER_TYPES = ['prospect', 'customer', 'partner'] as const;

// Presentation-only class strings
const thCls = 'px-4 py-3.5 text-left text-[11px] font-semibold text-ink-3 uppercase tracking-[0.08em]';
const heroPrimaryBtn = 'inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-white text-indigo-700 font-semibold text-sm shadow-lg shadow-indigo-900/20 hover:bg-blue-50 hover:-translate-y-px transition-all';

export default function AccountsPage() {
  const qc = useQueryClient();
  const permissions = usePermissions();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState({
    companyName: '', website: '', industry: '', companySize: '',
    country: '', state: '', customerType: 'prospect',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list().then(r => {
      const d = r.data?.data ?? r.data;
      return Array.isArray(d) ? d : d?.items ?? [];
    }),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => editItem ? accountsApi.update(editItem.id, data) : accountsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(editItem ? 'Account updated' : 'Account created');
      closeModal();
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Operation failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => accountsApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); toast.success('Account deleted'); },
    onError: () => toast.error('Failed to delete'),
  });

  function openCreate() {
    setEditItem(null);
    setForm({ companyName: '', website: '', industry: '', companySize: '', country: '', state: '', customerType: 'prospect' });
    setModalOpen(true);
  }

  function openEdit(item: any) {
    setEditItem(item);
    setForm({
      companyName: item.companyName,
      website: item.website ?? '',
      industry: item.industry ?? '',
      companySize: item.companySize ?? '',
      country: item.country ?? '',
      state: item.state ?? '',
      customerType: item.customerType ?? 'prospect',
    });
    setModalOpen(true);
  }

  function closeModal() { setModalOpen(false); setEditItem(null); }

  const accounts = Array.isArray(data) ? data : [];
  const filtered = accounts.filter((a: any) => a.companyName?.toLowerCase().includes(search.toLowerCase()));
  const canEditRows = permissions.isAdmin || permissions.isManager;

  return (
    <div className="space-y-6">
      <PageHero
        icon={Building2}
        eyebrow="CRM"
        title="Accounts"
        subtitle={<>{accounts.length} companies in your book of business</>}
      >
        <button className={heroPrimaryBtn} onClick={openCreate}><Plus size={16} /> Add Account</button>
      </PageHero>

      {/* Summary */}
      {accounts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiCard icon={Building2} tone="blue" label="Total accounts" value={accounts.length} />
          <KpiCard icon={BadgeCheck} tone="emerald" label="Customers" value={accounts.filter((a: any) => a.customerType === 'customer').length} />
          <KpiCard icon={Target} tone="amber" label="Prospects" value={accounts.filter((a: any) => a.customerType === 'prospect').length} />
          <KpiCard icon={Handshake} tone="violet" label="Partners" value={accounts.filter((a: any) => a.customerType === 'partner').length} />
        </div>
      )}

      {/* Toolbar */}
      <div className="card p-3 flex gap-2.5 flex-wrap items-center">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center bg-blue-500/10 text-blue-600 dark:text-blue-400 z-10">
            <Search size={14} />
          </span>
          <input className="input pl-10 h-10 text-[13px]" placeholder="Search by company name…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <span className="ml-auto text-xs font-medium text-ink-3 tabular-nums">
          {filtered.length} of {accounts.length} shown
        </span>
      </div>

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-[2px] p-4 animate-fade-in">
          <div className="relative bg-white dark:bg-surface border border-line rounded-2xl p-6 pt-7 w-full max-w-md shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500" />
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/30 flex items-center justify-center">
                  {editItem ? <Pencil size={17} /> : <Building2 size={18} />}
                </div>
                <div>
                  <h2 className="font-display text-base font-semibold text-ink">{editItem ? 'Edit Account' : 'New Account'}</h2>
                  <p className="text-xs text-ink-3">{editItem ? 'Update company details' : 'Add a company to your CRM'}</p>
                </div>
              </div>
              <button onClick={closeModal} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/[0.06] transition-colors" title="Close account modal"><X size={16} /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); createMutation.mutate(form); }} className="space-y-3.5">
              <div>
                <label className="label mb-1.5 block">Company Name <span className="text-rose-500">*</span></label>
                <input className="input" required value={form.companyName} onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))} placeholder="Acme Inc." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1.5 block">Website</label>
                  <input className="input" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://..." />
                </div>
                <div>
                  <label className="label mb-1.5 block">Industry</label>
                  <input className="input" value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} placeholder="Technology" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1.5 block">Company Size</label>
                  <input className="input" value={form.companySize} onChange={e => setForm(f => ({ ...f, companySize: e.target.value }))} placeholder="1-10" />
                </div>
                <div>
                  <label className="label mb-1.5 block">Country</label>
                  <input className="input" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder="US" />
                </div>
              </div>
              <div>
                <label className="label mb-1.5 block">State</label>
                <input className="input" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} placeholder="California" />
              </div>
              <div>
                <label className="label mb-1.5 block">Customer Type</label>
                <Select className="input" title="Customer type" value={form.customerType} onChange={e => setForm(f => ({ ...f, customerType: e.target.value }))}>
                  {CUSTOMER_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </Select>
              </div>
              <div className="flex gap-2 pt-3">
                <button type="button" onClick={closeModal} className="btn-ghost flex-1">Cancel</button>
                <button type="submit" className="btn-primary flex-1" disabled={createMutation.isPending}>
                  {editItem ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Spinner size={24} /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Building2} title="No accounts yet" description="Add your first company account to get started" action={<button className="btn-primary" onClick={openCreate}><Plus size={14} /> Add Account</button>} />
        ) : (
          <>
            <div className="px-5 py-4 border-b border-slate-100 dark:border-white/[0.06] flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <Building2 size={18} />
              </div>
              <h2 className="section-title flex-1">All Accounts</h2>
              <span className="text-xs font-bold tabular-nums px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-300">
                {filtered.length}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="bg-slate-50 dark:bg-surface-2">
                  <tr className="border-b border-line">
                    {['Company Name', 'Industry', 'Customer Type', 'Account Owner', 'Created Date', 'Actions'].map(h => (
                      <th key={h} className={thCls}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a: any) => (
                    <tr key={a.id} className="border-b border-slate-100 dark:border-white/[0.04] hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm flex items-center justify-center flex-shrink-0">
                            <Building2 size={14} />
                          </span>
                          <span className="text-sm font-semibold text-ink truncate">{a.companyName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-sm text-ink-2">{a.industry || '—'}</td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold capitalize ${a.customerType === 'customer' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : a.customerType === 'partner' ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300' : 'bg-slate-400/10 text-ink-2'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${a.customerType === 'customer' ? 'bg-emerald-500' : a.customerType === 'partner' ? 'bg-blue-500' : 'bg-slate-400'}`} />
                          {a.customerType}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-sm font-medium text-ink-2">{a.accountOwner?.name || '—'}</td>
                      <td className="px-4 py-3.5 text-xs text-ink-3">
                        <span className="inline-flex items-center gap-1"><CalendarDays size={11} /> {a.createdAt ? formatDate(a.createdAt) : '—'}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          {canEditRows && (
                            <button className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 transition-colors" onClick={() => openEdit(a)} title="Edit account"><Pencil size={14} /></button>
                          )}
                          {permissions.isAdmin && (
                            <button
                              className="w-8 h-8 rounded-lg flex items-center justify-center bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
                              title="Delete account"
                              onClick={() => {
                                if (window.confirm('Delete this account?')) {
                                  deleteMutation.mutate(a.id);
                                }
                              }}
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
