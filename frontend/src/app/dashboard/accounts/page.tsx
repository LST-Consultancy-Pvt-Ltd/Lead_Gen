'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountsApi } from '../../../lib/api';
import { usePermissions } from '../../../lib/rbac';
import { Badge, Spinner, EmptyState } from '../../../components/ui';
import { formatDate } from '../../../lib/utils';
import { Building2, Plus, Search, Pencil, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';

const CUSTOMER_TYPES = ['prospect', 'customer', 'partner'] as const;

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
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Accounts</h1>
          <p className="text-sm text-slate-500 mt-1">{accounts.length} companies</p>
        </div>
        <button className="btn-primary" onClick={openCreate}><Plus size={14} /> Add Account</button>
      </div>

      <div className="relative w-64">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input className="input pl-8 h-9 text-xs" placeholder="Search by company name…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-100">{editItem ? 'Edit Account' : 'New Account'}</h2>
              <button onClick={closeModal} className="text-slate-500 hover:text-slate-300" title="Close account modal"><X size={16} /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); createMutation.mutate(form); }} className="space-y-3">
              <div>
                <label className="label mb-1 block">Company Name <span className="text-red-400">*</span></label>
                <input className="input" required value={form.companyName} onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))} placeholder="Acme Inc." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1 block">Website</label>
                  <input className="input" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://..." />
                </div>
                <div>
                  <label className="label mb-1 block">Industry</label>
                  <input className="input" value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} placeholder="Technology" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1 block">Company Size</label>
                  <input className="input" value={form.companySize} onChange={e => setForm(f => ({ ...f, companySize: e.target.value }))} placeholder="1-10" />
                </div>
                <div>
                  <label className="label mb-1 block">Country</label>
                  <input className="input" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder="US" />
                </div>
              </div>
              <div>
                <label className="label mb-1 block">State</label>
                <input className="input" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} placeholder="California" />
              </div>
              <div>
                <label className="label mb-1 block">Customer Type</label>
                <select className="input" title="Customer type" value={form.customerType} onChange={e => setForm(f => ({ ...f, customerType: e.target.value }))}>
                  {CUSTOMER_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>
              <div className="flex gap-2 pt-2">
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
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['Company Name', 'Industry', 'Customer Type', 'Account Owner', 'Created Date', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((a: any) => (
                  <tr key={a.id} className="border-b border-white/[0.04] hover:bg-slate-800/20 transition-colors">
                    <td className="px-4 py-3 text-sm font-semibold text-slate-200">{a.companyName}</td>
                    <td className="px-4 py-3 text-sm text-slate-400">{a.industry || '—'}</td>
                    <td className="px-4 py-3">
                      <Badge color={a.customerType === 'customer' ? 'green' : a.customerType === 'partner' ? 'blue' : 'gray'}>
                        {a.customerType}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400">{a.accountOwner?.name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-400">{a.createdAt ? formatDate(a.createdAt) : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {canEditRows && (
                          <button className="btn-ghost text-xs py-1 px-2" onClick={() => openEdit(a)} title="Edit account"><Pencil size={12} /></button>
                        )}
                        {permissions.isAdmin && (
                          <button
                            className="btn-ghost text-xs py-1 px-2 text-slate-500"
                            title="Delete account"
                            onClick={() => {
                              if (window.confirm('Delete this account?')) {
                                deleteMutation.mutate(a.id);
                              }
                            }}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
