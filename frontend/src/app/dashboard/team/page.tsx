'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { teamApi, invitationsApi, usersApi } from '../../../lib/api';
import { usePermissions } from '../../../lib/rbac';
import { usePermissions as useAuthPermissions } from '../../../store/authStore';
import { RoleGuard } from '../../../components/common/RoleGuard';
import { Badge, Avatar, Spinner, EmptyState } from '../../../components/ui';
import { getInitials, timeAgo, getRoleLabel, getRoleBadgeColor } from '../../../lib/utils';
import { UserCog, Plus, Loader2, Users, Mail, X, ChevronRight, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';

export default function TeamPage() {
  const permissions = usePermissions();
  const authPerms = useAuthPermissions();
  const router = useRouter();
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'sales_user', managerId: '' });
  const [expandedAdmins, setExpandedAdmins] = useState<Record<string, boolean>>({});
  const [expandedManagers, setExpandedManagers] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (permissions.isSalesUser) {
      toast.error('You do not have access to this page');
      router.replace('/dashboard');
    }
  }, [permissions.isSalesUser, router]);

  const { data, isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: () => teamApi.list().then(r => ({ items: Array.isArray(r.data.data) ? r.data.data : r.data.data?.items ?? [] })),
    enabled: !permissions.isSalesUser,
  });

  const { data: invitationsData } = useQuery({
    queryKey: ['invitations'],
    queryFn: () => invitationsApi.list().then(r => r.data?.data ?? r.data ?? []),
    enabled: !permissions.isSalesUser,
  });

  const inviteMutation = useMutation({
    mutationFn: () => invitationsApi.send({
      email: inviteForm.email,
      role: authPerms.isManager ? 'sales_user' : inviteForm.role,
      managerId: inviteForm.role === 'sales_user' && inviteForm.managerId ? inviteForm.managerId : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invitations'] });
      setInviteOpen(false);
      setInviteForm({ email: '', role: 'sales_user', managerId: '' });
      toast.success('Invitation sent!');
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to send invitation'),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => invitationsApi.revoke(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invitations'] }); toast.success('Invitation revoked'); },
    onError: () => toast.error('Failed to revoke'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => teamApi.update(id, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  });

  if (permissions.isSalesUser) return null;

  const members: any[] = data?.items ?? [];
  const invitations: any[] = Array.isArray(invitationsData) ? invitationsData : [];
  const isReadOnly = !permissions.canManageUsers;

  // Build hierarchy
  const admins = members.filter((m: any) => m.role === 'org_admin' || m.role === 'super_admin');
  const managers = members.filter((m: any) => m.role === 'manager');
  const salesUsers = members.filter((m: any) => m.role === 'sales_user');

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Team Management</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage roles, permissions, and access{isReadOnly && ' (Read-only view)'}
          </p>
        </div>
        {(authPerms.canInviteSalesUsers || authPerms.canInviteManagers) && (
          <button className="btn-primary" onClick={() => setInviteOpen(true)}>
            <Plus size={14} /> Invite User
          </button>
        )}
      </div>

      {/* Team Structure — admin only */}
      {authPerms.canManageUsers && members.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users size={15} className="text-blue-400" />
            <h2 className="section-title">Team Structure</h2>
          </div>
          <div className="space-y-2">
            {admins.map((a: any) => (
              <div key={a.id}>
                <button
                  className="w-full flex items-center gap-2 py-1.5 hover:bg-slate-50 dark:hover:bg-white/[0.03] rounded-lg px-2 transition-colors"
                  onClick={() => setExpandedAdmins(prev => ({ ...prev, [a.id]: !prev[a.id] }))}
                >
                  {expandedAdmins[a.id] ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                  <Avatar initials={getInitials(a.name)} size="sm" />
                  <div className="text-left">
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{a.name}</span>
                    <span className="text-xs text-slate-500 ml-2">{a.email}</span>
                  </div>
                  <Badge color="green" className="ml-auto">Admin</Badge>
                </button>
                {expandedAdmins[a.id] && managers.map((mgr: any) => (
                  <div key={mgr.id} className="ml-6 border-l border-slate-200 dark:border-white/[0.06] pl-4">
                    <button
                      className="w-full flex items-center gap-2 py-1.5 hover:bg-slate-50 dark:hover:bg-white/[0.03] rounded-lg px-2 transition-colors"
                      onClick={() => setExpandedManagers(prev => ({ ...prev, [mgr.id]: !prev[mgr.id] }))}
                    >
                      {expandedManagers[mgr.id] ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}
                      <Avatar initials={getInitials(mgr.name)} size="sm" />
                      <div className="text-left">
                        <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{mgr.name}</span>
                        <span className="text-xs text-slate-500 ml-2">{mgr.email}</span>
                      </div>
                      <Badge color="blue" className="ml-auto">Sales Manager</Badge>
                    </button>
                    {expandedManagers[mgr.id] && salesUsers.filter((s: any) => s.managerId === mgr.id).map((su: any) => (
                      <div key={su.id} className="ml-6 border-l border-slate-200 dark:border-white/[0.06] pl-4">
                        <div className="flex items-center gap-2 py-1.5 px-2">
                          <Avatar initials={getInitials(su.name)} size="sm" />
                          <div>
                            <span className="text-sm text-slate-600 dark:text-slate-300">{su.name}</span>
                            <span className="text-xs text-slate-500 ml-2">{su.email}</span>
                          </div>
                          <Badge color="teal" className="ml-auto">Sales Executive</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
                {/* Unassigned sales users shown directly under admin */}
                {expandedAdmins[a.id] && salesUsers.filter((s: any) => !s.managerId).length > 0 && (
                  <div className="ml-6 border-l border-slate-200 dark:border-white/[0.06] pl-4 mt-1">
                    <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-2 py-1">Unassigned</div>
                    {salesUsers.filter((s: any) => !s.managerId).map((su: any) => (
                      <div key={su.id} className="flex items-center gap-2 py-1.5 px-2">
                        <Avatar initials={getInitials(su.name)} size="sm" />
                        <div>
                          <span className="text-sm text-slate-600 dark:text-slate-300">{su.name}</span>
                          <span className="text-xs text-slate-500 ml-2">{su.email}</span>
                        </div>
                        <Badge color="teal" className="ml-auto">Sales Executive</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {inviteOpen && (
        <div className="card p-5 border-blue-500/20 bg-blue-500/[0.04]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title">Invite Team Member</h3>
            <button title="Close" onClick={() => setInviteOpen(false)} className="text-slate-500 hover:text-slate-500 dark:hover:text-slate-300">
              <X size={16} />
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="label mb-1.5 block">Email <span className="text-red-400">*</span></label>
              <input
                className="input text-sm"
                type="email"
                value={inviteForm.email}
                onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                placeholder="colleague@company.com"
              />
            </div>
            {/* Role selector — admins can choose, managers always invite sales_user */}
            {authPerms.isAdmin && (
              <div>
                <label className="label mb-1.5 block">Role</label>
                <select
                  title="Select role"
                  className="input text-sm"
                  value={inviteForm.role}
                  onChange={e => setInviteForm(f => ({ ...f, role: e.target.value, managerId: '' }))}
                >
                  <option value="sales_user">Sales Executive</option>
                  <option value="manager">Sales Manager</option>
                </select>
              </div>
            )}
            {/* Manager assignment — only when admin invites a sales_user */}
            {authPerms.isAdmin && inviteForm.role === 'sales_user' && (
              <ManagerDropdown
                value={inviteForm.managerId}
                onChange={(id: string) => setInviteForm(f => ({ ...f, managerId: id }))}
                managers={managers}
              />
            )}
          </div>
          <div className="flex gap-2 mt-4">
            <button
              className="btn-primary"
              onClick={() => inviteMutation.mutate()}
              disabled={inviteMutation.isPending || !inviteForm.email}
            >
              {inviteMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
              Send Invitation
            </button>
            <button className="btn-ghost" onClick={() => setInviteOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Pending Invitations */}
      {invitations.filter((inv: any) => inv.status === 'pending').length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-white/[0.06]">
            <h2 className="section-title">Pending Invitations</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed">
              <colgroup>
                <col style={{width:'25%'}} />
                <col style={{width:'13%'}} />
                <col style={{width:'13%'}} />
                <col style={{width:'13%'}} />
                <col style={{width:'14%'}} />
                <col style={{width:'7%'}} />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/[0.06]">
                  {['Email', 'Role', 'Status', 'Sent By', 'Expires', 'Action'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invitations.filter((inv: any) => inv.status === 'pending').map((inv: any) => (
                  <tr key={inv.id} className="border-b border-slate-200 dark:border-white/[0.04] hover:bg-slate-200/20 dark:hover:bg-slate-800/20">
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{inv.email}</td>
                    <td className="px-4 py-3"><Badge color={inv.role === 'manager' ? 'blue' : 'slate'}>{getRoleLabel(inv.role)}</Badge></td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${inv.status === 'pending' ? 'text-amber-400' : inv.status === 'accepted' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{inv.invitedBy?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{inv.expiresAt ? timeAgo(inv.expiresAt) : '—'}</td>
                    <td className="px-4 py-3">
                      {inv.status === 'pending' && (
                        <button
                          className="btn-ghost text-xs py-1 px-2 text-red-400 hover:text-red-300"
                          onClick={() => revokeMutation.mutate(inv.id)}
                          disabled={revokeMutation.isPending}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Team Members Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Spinner size={24} /></div>
        ) : members.length === 0 ? (
          <EmptyState icon={UserCog} title="No team members" description="Invite your team to start collaborating on leads" action={<button className="btn-primary" onClick={() => setInviteOpen(true)}><Plus size={14} /> Invite First Member</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed">
              <colgroup>
                <col style={{width:'25%'}} />
                <col style={{width:'13%'}} />
                <col style={{width:'13%'}} />
                <col style={{width:'13%'}} />
                <col style={{width:'14%'}} />
                <col style={{width:'7%'}} />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/[0.06]">
                  {['User', 'Role', 'Status', /* 'Leads', */ 'Last Login', ...(isReadOnly ? [] : ['Actions'])].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((m: any) => (
                  <tr key={m.id} className="border-b border-slate-200 dark:border-white/[0.04] hover:bg-slate-200/20 dark:hover:bg-slate-800/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar initials={getInitials(m.name)} size="sm" />
                        <div>
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{m.name}</p>
                          <p className="text-xs text-slate-500">{m.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><Badge color={getRoleBadgeColor(m.role)}>{getRoleLabel(m.role)}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${m.isActive ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                        <span className={`text-xs ${m.isActive ? 'text-emerald-400' : 'text-slate-500'}`}>{m.isActive ? 'Active' : 'Inactive'}</span>
                      </div>
                    </td>
                    {/* <td className="px-4 py-3 text-sm text-slate-400">{m._count?.assignedLeads ?? 0}</td> */}
                    <td className="px-4 py-3 text-xs text-slate-500">{m.lastLoginAt ? timeAgo(m.lastLoginAt) : 'Never'}</td>
                    {!isReadOnly && (
                      <td className="px-4 py-3">
                        <button className="btn-ghost text-xs py-1 px-2" onClick={() => toggleMutation.mutate({ id: m.id, isActive: !m.isActive })}>
                          {m.isActive ? 'Disable' : 'Enable'}
                        </button>
                      </td>
                    )}
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

function ManagerDropdown({ value, onChange, managers }: { value: string; onChange: (id: string) => void; managers: any[] }) {
  return (
    <div>
      <label className="label mb-1.5 block">Assign to Manager (optional)</label>
      <select title="Assign to manager" className="input text-sm" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">No manager assigned</option>
        {managers.map((m: any) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
    </div>
  );
}
