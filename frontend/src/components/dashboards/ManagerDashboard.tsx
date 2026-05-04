'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi, teamApi } from '../../lib/api';
import { Spinner } from '../../components/ui';
import { useDashboardSSE } from '../../hooks/useDashboardRefresh';
import { useUserRole } from '../../lib/rbac';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { startOfWeek, startOfMonth, subDays, startOfQuarter, format } from 'date-fns';
import { TrendingUp, UserPlus, Download, Target, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';

// â”€â”€ Date Range Helper (exported for AdminDashboard compatibility) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function getDateRange(preset: string) {
  const now = new Date();
  switch (preset) {
    case 'this_week':
      return { dateFrom: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'), dateTo: format(now, 'yyyy-MM-dd') };
    case 'this_month':
      return { dateFrom: format(startOfMonth(now), 'yyyy-MM-dd'), dateTo: format(now, 'yyyy-MM-dd') };
    case 'last_30':
      return { dateFrom: format(subDays(now, 30), 'yyyy-MM-dd'), dateTo: format(now, 'yyyy-MM-dd') };
    case 'this_quarter':
      return { dateFrom: format(startOfQuarter(now), 'yyyy-MM-dd'), dateTo: format(now, 'yyyy-MM-dd') };
    default:
      return { dateFrom: format(subDays(now, 30), 'yyyy-MM-dd'), dateTo: format(now, 'yyyy-MM-dd') };
  }
}

// â”€â”€ buildManagerWidgets kept as a no-op export for any lingering references â”€
export function buildManagerWidgets(_data: any) { return []; }

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const AVATAR_COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-violet-500', 'bg-red-500', 'bg-cyan-500'];

function getAvatarColor(name: string) {
  const hash = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function Avatar({ name }: { name: string }) {
  const initials = (name || 'U').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${getAvatarColor(name)}`}>
      {initials}
    </div>
  );
}

function daysOverdue(dateStr: string) {
  if (!dateStr) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000));
}

const DATE_PRESET_LABELS: Record<string, string> = {
  this_week: 'This week',
  this_month: 'This month',
  last_30: 'Last 30 days',
  this_quarter: 'This quarter',
};

// â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function ManagerDashboard() {
  const role = useUserRole();
  useDashboardSSE(role);
  const router = useRouter();

  const [datePreset, setDatePreset] = useState('last_30');
  const [selectedExecId, setSelectedExecId] = useState('');
  const params = { ...getDateRange(datePreset), ...(selectedExecId ? { executiveId: selectedExecId } : {}) };

  // Fetch team members to populate the executive dropdown
  const { data: teamData } = useQuery({
    queryKey: ['team'],
    queryFn: () => teamApi.list().then((r) => r.data?.data ?? r.data ?? []),
    staleTime: 60_000,
  });
  const executives: any[] = Array.isArray(teamData)
    ? teamData.filter((u: any) => u.role === 'sales_user' && u.isActive !== false)
    : [];

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'manager', datePreset, selectedExecId],
    queryFn: () => analyticsApi.getManagerDashboard(params).then((r) => r.data?.data ?? r.data ?? {}),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Spinner size={24} /></div>;
  }

  // â”€â”€ Data derivations â€” ALL sourced from manager dashboard, filtered by date â”€â”€
  const execList: any[] = Array.isArray(data?.leadsByExecutive) ? data.leadsByExecutive : [];
  const convList: any[] = Array.isArray(data?.conversionRateByExecutive) ? data.conversionRateByExecutive : [];
  const leadsStatusMap: Record<string, number> = data?.leadsStatusMap ?? {};

  // KPI counts â€” from leadsStatusMap (date-filtered, team-scoped)
  const newCount = leadsStatusMap['new'] ?? 0;
  const contactedCount = leadsStatusMap['contacted'] ?? 0;
  const qualifiedCount = leadsStatusMap['qualified'] ?? 0;
  const closedWonCount = leadsStatusMap['closed_won'] ?? 0;

  // Team leads total = sum of all statuses in the filtered period
  const teamLeadsTotal = Object.values(leadsStatusMap).reduce((a, b) => a + b, 0)
    || execList.reduce((s, e) => s + (e.count ?? 0), 0);

  // Overdue follow-ups
  const overdueRaw = data?.overdueFollowUps ?? data?.overdueFollowups;
  const overdueLeads: any[] = Array.isArray(overdueRaw?.leads)
    ? overdueRaw.leads
    : Array.isArray(overdueRaw)
      ? overdueRaw
      : [];

  // Revenue closed
  const revenueClosedRaw = data?.revenueClosed;
  const revenueDealCount = typeof revenueClosedRaw === 'object' ? (revenueClosedRaw?.dealCount ?? 0) : 0;

  // Pipeline funnel â€” all from date-filtered lead status counts
  const funnelData = [
    { key: 'new', label: 'Generated', count: teamLeadsTotal, color: '#3b82f6' },
    { key: 'contacted', label: 'Contacted', count: contactedCount, color: '#10b981' },
    { key: 'qualified', label: 'Qualified', count: qualifiedCount, color: '#f59e0b' },
    { key: 'closed_won', label: 'Closed won', count: closedWonCount, color: '#8b5cf6' },
  ];
  const funnelMax = Math.max(...funnelData.map((f) => f.count), 1);

  // Exec leaderboard â€” top 3 by lead count within date range
  const leaderboard = [...execList]
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, 3)
    .map((e) => {
      const conv = convList.find((c) => c.user?.id === e.user?.id);
      return {        id: e.user?.id ?? e.user?.name ?? Math.random().toString(),        name: e.user?.name ?? 'â€”',
        leads: e.count ?? 0,
        closed: conv?.converted ?? 0,
        score: Math.round((e.count ?? 0) * 0.2 + (conv?.converted ?? 0) * 0.5),
      };
    });

  // Exec bar chart
  const execBarData = execList
    .filter((e) => (e.count ?? 0) > 0)
    .map((e, i) => ({
      id: e.user?.id ?? i,
      name: (e.user?.name ?? '').split(' ')[0],
      leads: e.count ?? 0,
    }));

  const pendingFollowUps = overdueLeads.length;
  const qualRate = teamLeadsTotal > 0 ? ((qualifiedCount / teamLeadsTotal) * 100).toFixed(0) : '0';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        {/* <div>
          <span className="text-xs bg-green-500/10 border border-green-500/20 text-green-400 px-3 py-1 rounded-full font-medium">
            Full team visibility
          </span>
        </div> */}
        <div className="flex items-center gap-2 ml-auto">
          {executives.length > 0 && (
            <select
              value={selectedExecId}
              onChange={(e) => setSelectedExecId(e.target.value)}
              aria-label="Filter by executive"
              className="text-xs bg-slate-800 border border-white/10 text-slate-300 rounded-xl px-3 py-1.5 outline-none cursor-pointer"
            >
              <option value="">All executives</option>
              {executives.map((exec: any) => (
                <option key={exec.id} value={exec.id}>{exec.name}</option>
              ))}
            </select>
          )}
          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value)}
            aria-label="Date range"
            className="text-xs bg-slate-800 border border-white/10 text-slate-300 rounded-xl px-3 py-1.5 outline-none cursor-pointer"
          >
            <option value="this_week">This week</option>
            <option value="this_month">This month</option>
            <option value="last_30">Last 30 days</option>
            <option value="this_quarter">This quarter</option>
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5">
          <p className="text-xs text-slate-500 mb-1">Team leads</p>
          <p className="text-2xl font-bold text-slate-100">{teamLeadsTotal.toLocaleString()}</p>
          <p className="text-xs text-slate-500 mt-1">{DATE_PRESET_LABELS[datePreset]}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-slate-500 mb-1">Qualified</p>
          <p className="text-2xl font-bold text-slate-100">{qualifiedCount}</p>
          <p className="text-xs text-slate-500 mt-1">{qualRate}% qualification rate</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-slate-500 mb-1">Closed / won</p>
          <p className="text-2xl font-bold text-slate-100">{closedWonCount}</p>
          <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
            <TrendingUp size={10} /> {DATE_PRESET_LABELS[datePreset]}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-slate-500 mb-1">Overdue follow-ups</p>
          <p className="text-2xl font-bold text-slate-100">{pendingFollowUps}</p>
          {pendingFollowUps > 0 && (
            <p className="text-xs text-red-400 mt-1">{pendingFollowUps} need attention</p>
          )}
        </div>
      </div>

      {/* Middle Row: Pipeline Funnel + Exec Leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pipeline funnel */}
        <div className="card p-5">
          <h2 className="section-title mb-1">Pipeline funnel</h2>
          <p className="text-xs text-slate-500 mb-5">{DATE_PRESET_LABELS[datePreset]}</p>
          <div className="space-y-4">
            {funnelData.map((stage) => (
              <div key={stage.key}>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-slate-300">{stage.label}</span>
                  <span className="text-slate-400 font-semibold">{stage.count.toLocaleString()}</span>
                </div>
                <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${(stage.count / funnelMax) * 100}%`, backgroundColor: stage.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Exec leaderboard */}
        <div className="card p-5">
          <h2 className="section-title mb-1">Exec leaderboard</h2>
          <p className="text-xs text-slate-500 mb-4">{DATE_PRESET_LABELS[datePreset]}</p>
          {leaderboard.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">No exec data for this period</p>
          ) : (
            <div className="space-y-3">
              {leaderboard.map((exec, i) => (
                <div key={exec.id} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-500 w-4">{i + 1}</span>
                  <Avatar name={exec.name} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{exec.name}</p>
                    <p className="text-xs text-slate-500">
                      {exec.leads} leads &middot; {exec.closed} closed
                    </p>
                  </div>

                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Lower Row: Lead count by exec + Overdue follow-ups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lead count by exec (bar chart) */}
        <div className="card p-5">
          <h2 className="section-title mb-1">Lead count by exec</h2>
          <p className="text-xs text-slate-500 mb-4">{DATE_PRESET_LABELS[datePreset]}</p>
          {execBarData.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">No leads in this period</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={execBarData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  content={({ active, payload, label }: any) =>
                    active && payload?.length ? (
                      <div className="bg-slate-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs shadow-xl">
                        <span className="text-slate-400">{label}: </span>
                        <span className="text-blue-400 font-semibold">{payload[0].value} leads</span>
                      </div>
                    ) : null
                  }
                />
                <Bar dataKey="leads" radius={[3, 3, 0, 0]}>
                  {execBarData.map((_, idx) => (
                    <Cell
                      key={idx}
                      fill={['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'][idx % 6]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Overdue follow-ups */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="section-title">Overdue follow-ups</h2>
            {overdueLeads.length > 0 && (
              <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full border bg-red-500/15 text-red-400 border-red-500/25">
                {overdueLeads.length}
              </span>
            )}
          </div>
          {overdueLeads.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">No overdue follow-ups</p>
          ) : (
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {overdueLeads.slice(0, 5).map((lead: any, i: number) => {
                const days = daysOverdue(lead.followUpDate);
                const src = lead.source ?? 'manual';
                const srcLabel = src === 'position_discovery'
                  ? 'Position discovery'
                  : src === 'product_discovery'
                    ? 'Product discovery'
                    : 'Manual entry';
                return (
                  <div
                    key={lead.id || i}
                    onClick={() => lead.id && router.push(`/dashboard/leads/${lead.id}`)}
                    className="p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <p className="text-sm font-medium text-slate-200 truncate">{lead.companyName}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium flex-shrink-0 ${
                        lead.status === 'qualified'
                          ? 'bg-amber-500/15 text-amber-400 border-amber-500/25'
                          : lead.status === 'contacted'
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                            : lead.status === 'new'
                              ? 'bg-blue-500/15 text-blue-400 border-blue-500/25'
                              : 'bg-slate-500/15 text-slate-400 border-slate-500/25'
                      }`}>
                        {lead.status?.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mb-1.5">
                      Assigned to {lead.assignedTo?.name ?? 'Unassigned'} Â· {days > 0 ? `${days} day${days !== 1 ? 's' : ''} overdue` : 'Due today'}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-2 py-0.5 rounded-md border border-white/[0.06] text-slate-400">
                        {srcLabel}
                      </span>
                      {/* <button
                        onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/leads/${lead.id}`); }}
                        className="ml-auto text-xs text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        Re-assign â†’
                      </button> */}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Actions Bar */}
      {/* <div className="card p-4">
        <div className="flex flex-wrap gap-3">
          <button onClick={() => router.push('/dashboard/leads')} className="btn-ghost text-sm">
            <Target size={14} /> Assign leads
          </button>
          <button onClick={() => router.push('/dashboard/team')} className="btn-ghost text-sm">
            <RefreshCw size={14} /> Set targets
          </button>
          <button onClick={() => router.push('/dashboard/leads?export=1')} className="btn-ghost text-sm">
            <Download size={14} /> Export
          </button>
          <button onClick={() => router.push('/dashboard/leads/new')} className="btn-ghost text-sm">
            <UserPlus size={14} /> Add manual lead
          </button>
        </div>
      </div> */}
    </div>
  );
}
