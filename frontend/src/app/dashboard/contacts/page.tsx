'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { contactsApi, accountsApi } from '../../../lib/api';
import { usePermissions } from '../../../lib/rbac';
import { Avatar, Spinner, EmptyState } from '../../../components/ui';
import { PageHero } from '../../../components/ui/PageHero';
import { KpiCard } from '../../../components/dashboards/DashboardUI';
import { getInitials } from '../../../lib/utils';
import { Users, Plus, Search, Pencil, Trash2, X, UserPlus, Crown, TrendingUp, Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { Select } from '../../../components/ui/Select';

const INFLUENCE_LEVELS = ['high', 'medium', 'low'] as const;

// Presentation-only class strings
const thCls = 'px-4 py-3.5 text-left text-[11px] font-semibold text-ink-3 uppercase tracking-[0.08em]';
const heroPrimaryBtn = 'inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-white text-indigo-700 font-semibold text-sm shadow-lg shadow-indigo-900/20 hover:bg-blue-50 hover:-translate-y-px transition-all';

export default function ContactsPage() {
  const qc = useQueryClient();
  const permissions = usePermissions();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [accountSearch, setAccountSearch] = useState('');
  const [form, setForm] = useState({
    name: '', email: '', phone: '', designation: '',
    influenceLevel: 'medium', decisionMaker: false,
    linkedAccountId: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['contacts'],
    queryFn: () => contactsApi.list().then(r => {
      const d = r.data?.data ?? r.data;
      return Array.isArray(d) ? d : d?.items ?? [];
    }),
  });

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list().then(r => {
      const d = r.data?.data ?? r.data;
      return Array.isArray(d) ? d : d?.items ?? [];
    }),
  });

  const saveMutation = useMutation({
    mutationFn: (data: any) => editItem ? contactsApi.update(editItem.id, data) : contactsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(editItem ? 'Contact updated' : 'Contact created');
      closeModal();
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Operation failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => contactsApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contacts'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); toast.success('Contact deleted'); },
    onError: () => toast.error('Failed to delete'),
  });

  function openCreate() {
    setEditItem(null);
    setForm({ name: '', email: '', phone: '', designation: '', influenceLevel: 'medium', decisionMaker: false, linkedAccountId: '' });
    setModalOpen(true);
  }

  function openEdit(item: any) {
    setEditItem(item);
    setForm({ name: item.name, email: item.email ?? '', phone: item.phone ?? '', designation: item.designation ?? '', influenceLevel: item.influenceLevel ?? 'medium', decisionMaker: item.decisionMaker ?? false, linkedAccountId: item.linkedAccountId ?? '' });
    setModalOpen(true);
  }

  function closeModal() { setModalOpen(false); setEditItem(null); }

  const contacts = Array.isArray(data) ? data : [];
  const accounts = Array.isArray(accountsData) ? accountsData : [];
  const filteredAccounts = accounts.filter((a: any) =>
    a.companyName?.toLowerCase().includes(accountSearch.toLowerCase()),
  );
  const filtered = contacts.filter((c: any) =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase()) ||
    c.designation?.toLowerCase().includes(search.toLowerCase())
  );
  const canEditRows = permissions.isAdmin || permissions.isManager;


  return (
    <div className="space-y-6">
      <PageHero
        icon={Users}
        eyebrow="CRM"
        title="Contacts"
        subtitle={<>{contacts.length} contacts across your accounts</>}
      >
        <button className={heroPrimaryBtn} onClick={openCreate}><Plus size={16} /> Add Contact</button>
      </PageHero>

      {/* Summary */}
      {contacts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiCard icon={Users} tone="blue" label="Total contacts" value={contacts.length} />
          <KpiCard icon={Crown} tone="emerald" label="Decision makers" value={contacts.filter((c: any) => c.decisionMaker).length} />
          <KpiCard icon={TrendingUp} tone="rose" label="High influence" value={contacts.filter((c: any) => c.influenceLevel === 'high').length} />
          <KpiCard icon={Building2} tone="violet" label="Linked to accounts" value={contacts.filter((c: any) => c.linkedAccount?.id).length} />
        </div>
      )}

      {/* Toolbar */}
      <div className="card p-3 flex gap-2.5 flex-wrap items-center">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center bg-blue-500/10 text-blue-600 dark:text-blue-400 z-10">
            <Search size={14} />
          </span>
          <input className="input pl-10 h-10 text-[13px]" placeholder="Search contacts…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <span className="ml-auto text-xs font-medium text-ink-3 tabular-nums">
          {filtered.length} of {contacts.length} shown
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
                  {editItem ? <Pencil size={17} /> : <UserPlus size={18} />}
                </div>
                <div>
                  <h2 className="font-display text-base font-semibold text-ink">{editItem ? 'Edit Contact' : 'New Contact'}</h2>
                  <p className="text-xs text-ink-3">{editItem ? 'Update contact details' : 'Add a person to your CRM'}</p>
                </div>
              </div>
              <button onClick={closeModal} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/[0.06] transition-colors" title="Close contact modal"><X size={16} /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); saveMutation.mutate(form); }} className="space-y-3.5">
              <div>
                <label className="label mb-1.5 block">Full Name <span className="text-rose-500">*</span></label>
                <input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Jane Smith" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1.5 block">Email</label>
                  <input type="email" className="input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@company.com" />
                </div>
                <div>
                  <label className="label mb-1.5 block">Phone</label>
                  <input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+1 555 000 0000" />
                </div>
              </div>
              <div>
                <label className="label mb-1.5 block">Designation</label>
                <input className="input" value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} placeholder="VP of Engineering" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1.5 block">Influence Level</label>
                  <Select className="input" title="Influence level" value={form.influenceLevel} onChange={e => setForm(f => ({ ...f, influenceLevel: e.target.value }))}>
                    {INFLUENCE_LEVELS.map(l => <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>)}
                  </Select>
                </div>
                <div className="flex flex-col">
                  <label className="label mb-1.5 block">Decision Maker</label>
                  <label className="flex items-center gap-2.5 h-10 px-3 rounded-xl border border-line bg-white dark:bg-surface cursor-pointer hover:border-emerald-400 dark:hover:border-emerald-500/50 transition-colors">
                    <input type="checkbox" className="w-4 h-4 rounded border-slate-300 dark:border-white/20 bg-white dark:bg-surface-2 text-emerald-500 focus:ring-emerald-500/30" checked={form.decisionMaker} onChange={e => setForm(f => ({ ...f, decisionMaker: e.target.checked }))} />
                    <span className="text-[13px] font-medium text-ink-2">Yes</span>
                  </label>
                </div>
              </div>
              {accounts.length > 0 && (
                <div>
                  <label className="label mb-1.5 block">Linked Account</label>
                  <div className="relative mb-2">
                    <Search size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 z-10" />
                    <input
                      className="input pl-9"
                      value={accountSearch}
                      onChange={e => setAccountSearch(e.target.value)}
                      placeholder="Search account..."
                    />
                  </div>
                  <Select className="input" title="Linked account" value={form.linkedAccountId} onChange={e => setForm(f => ({ ...f, linkedAccountId: e.target.value }))}>
                    <option value="">— None —</option>
                    {filteredAccounts.map((a: any) => <option key={a.id} value={a.id}>{a.companyName}</option>)}
                  </Select>
                </div>
              )}
              <div className="flex gap-2 pt-3">
                <button type="button" onClick={closeModal} className="btn-ghost flex-1">Cancel</button>
                <button type="submit" className="btn-primary flex-1" disabled={saveMutation.isPending}>
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
          <EmptyState icon={Users} title="No contacts yet" description="Add your first contact to start building relationships" action={<button className="btn-primary" onClick={openCreate}><Plus size={14} /> Add Contact</button>} />
        ) : (
          <>
            <div className="px-5 py-4 border-b border-slate-100 dark:border-white/[0.06] flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <Users size={18} />
              </div>
              <h2 className="section-title flex-1">All Contacts</h2>
              <span className="text-xs font-bold tabular-nums px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-300">
                {filtered.length}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px]">
                <thead className="bg-slate-50 dark:bg-surface-2">
                  <tr className="border-b border-line">
                    {['Name', 'Email', 'Phone', 'Linked Account', 'Designation', 'Decision Maker', 'Influence Level', 'Actions'].map(h => (
                      <th key={h} className={thCls}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c: any) => (
                    <tr key={c.id} className="border-b border-slate-100 dark:border-white/[0.04] hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar initials={getInitials(c.name || '')} size="sm" />
                          <span className="text-sm font-semibold text-ink truncate">{c.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-sm text-ink-2">{c.email || '—'}</td>
                      <td className="px-4 py-3.5 text-sm text-ink-2 tabular-nums">{c.phone || '—'}</td>
                      <td className="px-4 py-3.5 text-sm">
                        {c.linkedAccount?.id ? (
                          <Link href={`/dashboard/accounts?accountId=${c.linkedAccount.id}`} className="inline-flex items-center gap-1.5 font-medium text-blue-600 dark:text-blue-400 hover:underline">
                            <Building2 size={13} />
                            {c.linkedAccount.companyName}
                          </Link>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-sm text-ink-2">{c.designation || '—'}</td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${c.decisionMaker ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-slate-400/10 text-ink-3'}`}>
                          {c.decisionMaker ? <Crown size={11} /> : null}
                          {c.decisionMaker ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold capitalize ${c.influenceLevel === 'high' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300' : c.influenceLevel === 'medium' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-blue-500/10 text-blue-700 dark:text-blue-300'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${c.influenceLevel === 'high' ? 'bg-rose-500' : c.influenceLevel === 'medium' ? 'bg-amber-500' : 'bg-blue-500'}`} />
                          {c.influenceLevel}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          {canEditRows && (
                            <button className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 transition-colors" onClick={() => openEdit(c)} title="Edit contact"><Pencil size={14} /></button>
                          )}
                          {permissions.isAdmin && (
                            <button
                              className="w-8 h-8 rounded-lg flex items-center justify-center bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
                              title="Delete contact"
                              onClick={() => {
                                if (window.confirm('Delete this contact?')) {
                                  deleteMutation.mutate(c.id);
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
