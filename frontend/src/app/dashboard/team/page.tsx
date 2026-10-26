'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { teamApi, invitationsApi, usersApi } from '../../../lib/api';
import { usePermissions } from '../../../lib/rbac';
import { usePermissions as useAuthPermissions } from '../../../store/authStore';
import { RoleGuard } from '../../../components/common/RoleGuard';
import { Badge, Avatar, Spinner, EmptyState } from '../../../components/ui';
import { PageHero } from '../../../components/ui/PageHero';
import { KpiCard } from '../../../components/dashboards/DashboardUI';
import { getInitials, timeAgo, getRoleLabel, getRoleBadgeColor } from '../../../lib/utils';
import {
  UserCog, Plus, Loader2, Users, Mail, X, ChevronRight, ChevronDown,
  ShieldCheck, Briefcase, UserCheck, Network, Send, Clock, Power, Hourglass,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Select } from '../../../components/ui/Select';

// Presentation-only role styling
function roleStyle(role: string) {
  if (role === 'org_admin' || role === 'super_admin') {
    return { pill: 'bg-violet-500/10 text-violet-700 dark:text-violet-300', ring: 'ring-violet-500/40', icon: ShieldCheck };
  }
  if (role === 'manager') {
    return { pill: 'bg-blue-500/10 text-blue-700 dark:text-blue-300', ring: 'ring-blue-500/40', icon: Briefcase };
  }
  return { pill: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-500/40', icon: UserCheck };
}

function RolePill({ role, label }: { role: string; label: string }) {
  const st = roleStyle(role);
  const Icon = st.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap ${st.pill}`}>
      <Icon size={11} /> {label}
    </span>
  );
}

const thCls = 'px-4 py-3.5 text-left text-[11px] font-semibold text-ink-3 uppercase tracking-[0.08em]';

export default function TeamPage() {
  const permissions = usePermissions();
  const authPerms = useAuthPermissions();
  const router = useRouter();
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'sales_user', managerId: '' });
  const [expandedAdmins, setExpandedAdmins] = useState<Record<string, boolean>>({});
  const [expandedManagers, setExpandedManagers] = useState<Record<string, boolean>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: () => teamApi.list().then(r => ({ items: Array.isArray(r.data.data) ? r.data.data : r.data.data?.items ?? [] })),
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
    onSuccess: () => {
      // Owner/assignee dropdowns elsewhere cache the team list under their own keys
      ['team', 'users-filter', 'users', 'team-members'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
    },
  });

  const members: any[] = data?.items ?? [];
  const invitations: any[] = Array.isArray(invitationsData) ? invitationsData : [];
  const isReadOnly = !permissions.canManageUsers;

  // Build hierarchy
  const admins = members.filter((m: any) => m.role === 'org_admin' || m.role === 'super_admin');
  const managers = members.filter((m: any) => m.role === 'manager');
  const salesUsers = members.filter((m: any) => m.role === 'sales_user');

  // Hierarchy from actual relationships: parent = manager, else inviter. Admins are roots.
  const memberById = new Map(members.map((m: any) => [m.id, m]));
  const isAdminRole = (m: any) => m.role === 'org_admin' || m.role === 'super_admin';
  const parentOf = (m: any) => {
    for (const pid of [m.managerId, m.invitedById]) {
      if (pid && pid !== m.id && memberById.has(pid)) return pid;
    }
    return null;
  };
  // Managers/executives first, then sub-admins (each carrying their own team)
  const childrenOf = (id: string) =>
    members.filter((m: any) => parentOf(m) === id)
      .sort((x: any, y: any) => Number(isAdminRole(x)) - Number(isAdminRole(y)));
  const toggleNode = (id: string) => setExpandedAdmins(prev => ({ ...prev, [id]: !(prev[id] ?? true) }));
  const roleBadge = (m: any) =>
    isAdminRole(m) ? <span className="ml-auto"><RolePill role={m.role} label="Admin" /></span>
    : m.role === 'manager' ? <span className="ml-auto"><RolePill role={m.role} label="Sales Manager" /></span>
    : <span className="ml-auto"><RolePill role={m.role} label="Sales Executive" /></span>;
  const renderNode = (m: any, depth: number): any => {
    const kids = childrenOf(m.id);
    const open = expandedAdmins[m.id] ?? true;
    const st = roleStyle(m.role);
    return (
      <div key={m.id} className={depth ? 'ml-5 sm:ml-7 border-l-2 border-dashed border-slate-200 dark:border-white/[0.08] pl-3 sm:pl-5' : ''}>
        <button
          className="group w-full flex items-center gap-3 py-2 px-2.5 my-0.5 rounded-xl border border-transparent hover:border-line dark:hover:border-white/[0.08] hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-all"
          onClick={() => kids.length && toggleNode(m.id)}
        >
          {kids.length === 0
            ? <span className="w-5" />
            : (
              <span className="w-5 h-5 rounded-md flex items-center justify-center bg-slate-100 dark:bg-white/[0.05] text-ink-3 flex-shrink-0">
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </span>
            )}
          <span className={`rounded-full ring-2 ${st.ring}`}>
            <Avatar initials={getInitials(m.name)} size="sm" />
          </span>
          <div className="text-left min-w-0">
            <p className="text-sm font-semibold text-ink truncate">{m.name}</p>
            <p className="text-xs text-ink-3 truncate">{m.email}</p>
          </div>
          {kids.length > 0 && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-ink-3 ml-2">
              <Users size={11} /> {kids.length}
            </span>
          )}
          {roleBadge(m)}
        </button>
        {open && kids.map((k: any) => renderNode(k, depth + 1))}
      </div>
    );
  };

  const pendingInvites = invitations.filter((inv: any) => inv.status === 'pending');

  return (
    <div className="space-y-6">
      <PageHero
        icon={Users}
        eyebrow="Organization"
        title="Team Management"
        subtitle={<>Manage roles, permissions, and access{isReadOnly && ' (Read-only view)'}</>}
      >
        {(authPerms.canInviteSalesUsers || authPerms.canInviteManagers) && (
          <button
            className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-white text-indigo-700 font-semibold text-sm shadow-lg shadow-indigo-900/20 hover:bg-blue-50 hover:-translate-y-px transition-all"
            onClick={() => setInviteOpen(true)}
          >
            <Plus size={16} /> Invite User
          </button>
        )}
      </PageHero>

      {/* Summary */}
      {members.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiCard icon={Users} tone="blue" label="Team members" value={members.length}>
            {members.filter((m: any) => m.isActive).length} active
          </KpiCard>
          <KpiCard icon={ShieldCheck} tone="violet" label="Admins" value={admins.length} />
          <KpiCard icon={Briefcase} tone="indigo" label="Sales managers" value={managers.length} />
          <KpiCard icon={UserCheck} tone="emerald" label="Sales executives" value={salesUsers.length} />
        </div>
      )}

      {/* Invite Modal */}
      {inviteOpen && (
        <div className="card relative overflow-hidden p-6 animate-fade-in">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500" />
          <div className="pointer-events-none absolute -right-16 -top-16 w-48 h-48 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="relative flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/30 flex items-center justify-center">
                <Mail size={18} />
              </div>
              <div>
                <h3 className="font-display text-base font-semibold text-ink">Invite Team Member</h3>
                <p className="text-xs text-ink-3">They'll receive an email invitation to join</p>
              </div>
            </div>
            <button title="Close" onClick={() => setInviteOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/[0.06] transition-colors">
              <X size={16} />
            </button>
          </div>
          <div className="relative grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label mb-1.5 block">Email <span className="text-rose-500">*</span></label>
              <div className="relative">
                <Mail size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 z-10" />
                <input
                  className="input text-sm pl-9"
                  type="email"
                  value={inviteForm.email}
                  onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="colleague@company.com"
                />
              </div>
            </div>
            {/* Role selector — admins can choose, managers always invite sales_user */}
            {authPerms.isAdmin && (
              <div>
                <label className="label mb-1.5 block">Role</label>
                <Select
                  title="Select role"
                  className="input text-sm"
                  value={inviteForm.role}
                  onChange={e => setInviteForm(f => ({ ...f, role: e.target.value, managerId: '' }))}
                >
                  <option value="sales_user">Sales Executive</option>
                  <option value="manager">Sales Manager</option>
                </Select>
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
          <div className="relative flex gap-2 mt-5">
            <button
              className="btn-primary px-5 py-2.5"
              onClick={() => inviteMutation.mutate()}
              disabled={inviteMutation.isPending || !inviteForm.email}
            >
              {inviteMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Send Invitation
            </button>
            <button className="btn-ghost px-4 py-2.5" onClick={() => setInviteOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Team Structure — visible to every role (own team only). Built from real parent links (managerId / invitedById), not roles */}
      {members.length > 0 && (
        <div className="card relative overflow-hidden p-5">
          <div className="pointer-events-none absolute -right-16 -top-16 w-48 h-48 rounded-full bg-indigo-500/10 blur-3xl" />
          <div className="relative flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Network size={18} />
            </div>
            <div>
              <h2 className="section-title">Team Structure</h2>
              <p className="text-xs text-ink-3 mt-0.5">Who reports to whom</p>
            </div>
          </div>
          <div className="relative space-y-1">
            {members.filter((m: any) => parentOf(m) === null).map((m: any) => renderNode(m, 0))}
          </div>
        </div>
      )}

      {/* Pending Invitations */}
      {pendingInvites.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-white/[0.06] flex items-center gap-3 bg-gradient-to-r from-amber-50/80 to-transparent dark:from-amber-500/[0.06]">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-md shadow-amber-500/30 flex items-center justify-center">
              <Hourglass size={17} />
            </div>
            <h2 className="section-title flex-1">Pending Invitations</h2>
            <span className="text-xs font-bold tabular-nums px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300">
              {pendingInvites.length}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed min-w-[720px]">
              <colgroup>
                <col style={{width:'25%'}} />
                <col style={{width:'13%'}} />
                <col style={{width:'13%'}} />
                <col style={{width:'13%'}} />
                <col style={{width:'14%'}} />
                <col style={{width:'7%'}} />
              </colgroup>
              <thead className="bg-slate-50 dark:bg-surface-2">
                <tr className="border-b border-line">
                  {['Email', 'Role', 'Status', 'Sent By', 'Expires', 'Action'].map(h => (
                    <th key={h} className={thCls}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pendingInvites.map((inv: any) => (
                  <tr key={inv.id} className="border-b border-slate-100 dark:border-white/[0.04] hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center gap-2 text-sm font-medium text-ink dark:text-slate-200 min-w-0">
                        <span className="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/[0.05] text-ink-3 flex items-center justify-center flex-shrink-0"><Mail size={14} /></span>
                        <span className="truncate">{inv.email}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3.5"><RolePill role={inv.role} label={getRoleLabel(inv.role)} /></td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold capitalize ${inv.status === 'pending' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : inv.status === 'accepted' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${inv.status === 'pending' ? 'bg-amber-500 animate-pulse' : inv.status === 'accepted' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs font-medium text-ink-2 truncate">{inv.invitedBy?.name ?? '—'}</td>
                    <td className="px-4 py-3.5 text-xs text-ink-3">
                      <span className="inline-flex items-center gap-1"><Clock size={11} /> {inv.expiresAt ? timeAgo(inv.expiresAt) : '—'}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      {inv.status === 'pending' && (
                        <button
                          className="inline-flex items-center h-7 px-2.5 rounded-lg text-xs font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
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
          <div className="divide-y divide-slate-100 dark:divide-white/[0.04] animate-pulse" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="w-8 h-8 rounded-full bg-slate-200/80 dark:bg-white/[0.06]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/4 rounded bg-slate-200/80 dark:bg-white/[0.06]" />
                  <div className="h-2.5 w-1/5 rounded bg-slate-200/60 dark:bg-white/[0.04]" />
                </div>
                <div className="h-6 w-24 rounded-md bg-slate-200/60 dark:bg-white/[0.04]" />
              </div>
            ))}
          </div>
        ) : members.length === 0 ? (
          <EmptyState icon={UserCog} title="No team members" description="Invite your team to start collaborating on leads" action={<button className="btn-primary" onClick={() => setInviteOpen(true)}><Plus size={14} /> Invite First Member</button>} />
        ) : (
          <>
            <div className="px-5 py-4 border-b border-slate-100 dark:border-white/[0.06] flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <UserCog size={18} />
              </div>
              <h2 className="section-title flex-1">Team Members</h2>
              <span className="text-xs font-bold tabular-nums px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-300">
                {members.length}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full table-fixed min-w-[640px]">
                <colgroup>
                  <col style={{width:'25%'}} />
                  <col style={{width:'13%'}} />
                  <col style={{width:'13%'}} />
                  <col style={{width:'13%'}} />
                  <col style={{width:'14%'}} />
                  <col style={{width:'7%'}} />
                </colgroup>
                <thead className="bg-slate-50 dark:bg-surface-2">
                  <tr className="border-b border-line">
                    {['User', 'Role', 'Status', /* 'Leads', */ 'Last Login', ...(isReadOnly ? [] : ['Actions'])].map(h => (
                      <th key={h} className={thCls}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {members.map((m: any) => (
                    <tr key={m.id} className="group border-b border-slate-100 dark:border-white/[0.04] hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={`rounded-full ring-2 ${roleStyle(m.role).ring} flex-shrink-0`}>
                            <Avatar initials={getInitials(m.name)} size="sm" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-ink truncate">{m.name}</p>
                            <p className="text-xs text-ink-3 truncate">{m.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5"><RolePill role={m.role} label={getRoleLabel(m.role)} /></td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold ${m.isActive ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-slate-400/10 text-ink-3'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${m.isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                          {m.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      {/* <td className="px-4 py-3 text-sm text-slate-400">{m._count?.assignedLeads ?? 0}</td> */}
                      <td className="px-4 py-3.5 text-xs text-ink-3">
                        <span className="inline-flex items-center gap-1"><Clock size={11} /> {m.lastLoginAt ? timeAgo(m.lastLoginAt) : 'Never'}</span>
                      </td>
                      {!isReadOnly && (
                        <td className="px-4 py-3.5">
                          <button
                            className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs font-semibold transition-colors ${m.isActive ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'}`}
                            onClick={() => toggleMutation.mutate({ id: m.id, isActive: !m.isActive })}
                          >
                            <Power size={11} /> {m.isActive ? 'Disable' : 'Enable'}
                          </button>
                        </td>
                      )}
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

function ManagerDropdown({ value, onChange, managers }: { value: string; onChange: (id: string) => void; managers: any[] }) {
  return (
    <div>
      <label className="label mb-1.5 block">Assign to Manager (optional)</label>
      <Select title="Assign to manager" className="input text-sm" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">No manager assigned</option>
        {managers.map((m: any) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </Select>
    </div>
  );
}
