'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { teamApi } from '../../../lib/api';
import { Badge, Avatar, Spinner, EmptyState } from '../../../components/ui';
import { getInitials, timeAgo } from '../../../lib/utils';
import { UserCog, Plus, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useState } from 'react';

export default function TeamPage() {
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: 'sales_user' });

  const { data, isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: () => teamApi.list().then(r => ({ items: Array.isArray(r.data.data) ? r.data.data : r.data.data?.items ?? [] })),
  });

  const inviteMutation = useMutation({
    mutationFn: () => teamApi.invite(inviteForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team'] }); setInviteOpen(false); toast.success('Invitation sent!'); },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to invite'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => teamApi.update(id, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  });

  const members: any[] = data?.items ?? [];
  const roleColors: Record<string,string> = { super_admin:'purple', org_admin:'blue', manager:'amber', sales_user:'gray' };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Team Management</h1>
          <p className="text-sm text-slate-500 mt-1">Manage roles, permissions, and access</p>
        </div>
        <button className="btn-primary" onClick={() => setInviteOpen(true)}><Plus size={14}/> Invite User</button>
      </div>

      {inviteOpen && (
        <div className="card p-5 border-blue-500/20 bg-blue-500/[0.04]">
          <h3 className="section-title mb-4">Invite Team Member</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div><label className="label mb-1.5 block">Name</label><input className="input text-sm" value={inviteForm.name} onChange={e=>setInviteForm({...inviteForm,name:e.target.value})} placeholder="Full name"/></div>
            <div><label className="label mb-1.5 block">Email</label><input className="input text-sm" type="email" value={inviteForm.email} onChange={e=>setInviteForm({...inviteForm,email:e.target.value})} placeholder="email@company.com"/></div>
            <div><label className="label mb-1.5 block">Role</label>
              <select className="input text-sm" value={inviteForm.role} onChange={e=>setInviteForm({...inviteForm,role:e.target.value})}>
                <option value="sales_user">Sales User</option>
                <option value="manager">Manager</option>
                <option value="org_admin">Org Admin</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => inviteMutation.mutate()} disabled={inviteMutation.isPending}>
              {inviteMutation.isPending ? <Loader2 size={14} className="animate-spin"/> : null} Send Invite
            </button>
            <button className="btn-ghost" onClick={() => setInviteOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Spinner size={24}/></div>
        ) : members.length === 0 ? (
          <EmptyState icon={UserCog} title="No team members" description="Invite your team to start collaborating on leads" action={<button className="btn-primary" onClick={() => setInviteOpen(true)}><Plus size={14}/> Invite First Member</button>}/>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['User','Role','Status','Leads','Last Login','Actions'].map(h=>(
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((m: any) => (
                  <tr key={m.id} className="border-b border-white/[0.04] hover:bg-slate-800/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar initials={getInitials(m.name)} size="sm"/>
                        <div>
                          <p className="text-sm font-semibold text-slate-200">{m.name}</p>
                          <p className="text-xs text-slate-500">{m.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><Badge color={roleColors[m.role]??'gray'}>{m.role.replace('_',' ')}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${m.isActive?'bg-emerald-400':'bg-slate-600'}`}/>
                        <span className={`text-xs ${m.isActive?'text-emerald-400':'text-slate-500'}`}>{m.isActive?'Active':'Inactive'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400">{m._count?.assignedLeads ?? 0}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{m.lastLoginAt ? timeAgo(m.lastLoginAt) : 'Never'}</td>
                    <td className="px-4 py-3">
                      <button className="btn-ghost text-xs py-1 px-2"
                        onClick={() => toggleMutation.mutate({ id: m.id, isActive: !m.isActive })}>
                        {m.isActive ? 'Disable' : 'Enable'}
                      </button>
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
