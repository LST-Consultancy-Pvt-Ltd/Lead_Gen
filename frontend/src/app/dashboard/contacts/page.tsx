'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { contactsApi, accountsApi } from '../../../lib/api';
import { usePermissions } from '../../../lib/rbac';
import { Badge, Spinner, EmptyState } from '../../../components/ui';
import { Users, Plus, Search, Pencil, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import Link from 'next/link';

const INFLUENCE_LEVELS = ['high', 'medium', 'low'] as const;

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
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Contacts</h1>
          <p className="text-sm text-slate-500 mt-1">{contacts.length} contacts</p>
        </div>
        <button className="btn-primary" onClick={openCreate}><Plus size={14} /> Add Contact</button>
      </div>

      <div className="relative w-48">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input className="input pl-8 h-9 text-xs" placeholder="Search contacts…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-100">{editItem ? 'Edit Contact' : 'New Contact'}</h2>
              <button onClick={closeModal} className="text-slate-500 hover:text-slate-300" title="Close contact modal"><X size={16} /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); saveMutation.mutate(form); }} className="space-y-3">
              <div>
                <label className="label mb-1 block">Full Name <span className="text-red-400">*</span></label>
                <input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Jane Smith" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1 block">Email</label>
                  <input type="email" className="input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@company.com" />
                </div>
                <div>
                  <label className="label mb-1 block">Phone</label>
                  <input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+1 555 000 0000" />
                </div>
              </div>
              <div>
                <label className="label mb-1 block">Designation</label>
                <input className="input" value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} placeholder="VP of Engineering" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1 block">Influence Level</label>
                  <select className="input" title="Influence level" value={form.influenceLevel} onChange={e => setForm(f => ({ ...f, influenceLevel: e.target.value }))}>
                    {INFLUENCE_LEVELS.map(l => <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>)}
                  </select>
                </div>
                <div className="flex flex-col">
                  <label className="label mb-1 block">Decision Maker</label>
                  <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 rounded border-white/20 bg-slate-800 text-emerald-500 focus:ring-emerald-500/30" checked={form.decisionMaker} onChange={e => setForm(f => ({ ...f, decisionMaker: e.target.checked }))} />
                    <span className="text-xs text-slate-400">Yes</span>
                  </label>
                </div>
              </div>
              {accounts.length > 0 && (
                <div>
                  <label className="label mb-1 block">Linked Account</label>
                  <input
                    className="input mb-2"
                    value={accountSearch}
                    onChange={e => setAccountSearch(e.target.value)}
                    placeholder="Search account..."
                  />
                  <select className="input" title="Linked account" value={form.linkedAccountId} onChange={e => setForm(f => ({ ...f, linkedAccountId: e.target.value }))}>
                    <option value="">— None —</option>
                    {filteredAccounts.map((a: any) => <option key={a.id} value={a.id}>{a.companyName}</option>)}
                  </select>
                </div>
              )}
              <div className="flex gap-2 pt-2">
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
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['Name', 'Email', 'Phone', 'Linked Account', 'Designation', 'Decision Maker', 'Influence Level', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c: any) => (
                  <tr key={c.id} className="border-b border-white/[0.04] hover:bg-slate-800/20 transition-colors">
                    <td className="px-4 py-3 text-sm font-semibold text-slate-200">{c.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-400">{c.email || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-400">{c.phone || '—'}</td>
                    <td className="px-4 py-3 text-sm">
                      {c.linkedAccount?.id ? (
                        <Link href={`/dashboard/accounts?accountId=${c.linkedAccount.id}`} className="text-blue-400 hover:underline">
                          {c.linkedAccount.companyName}
                        </Link>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400">{c.designation || '—'}</td>
                    <td className="px-4 py-3">
                      <Badge color={c.decisionMaker ? 'green' : 'gray'}>
                        {c.decisionMaker ? 'Yes' : 'No'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={c.influenceLevel === 'high' ? 'red' : c.influenceLevel === 'medium' ? 'amber' : 'blue'}>
                        {c.influenceLevel}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {canEditRows && (
                          <button className="btn-ghost text-xs py-1 px-2" onClick={() => openEdit(c)} title="Edit contact"><Pencil size={12} /></button>
                        )}
                        {permissions.isAdmin && (
                          <button
                            className="btn-ghost text-xs py-1 px-2 text-slate-500"
                            title="Delete contact"
                            onClick={() => {
                              if (window.confirm('Delete this contact?')) {
                                deleteMutation.mutate(c.id);
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
