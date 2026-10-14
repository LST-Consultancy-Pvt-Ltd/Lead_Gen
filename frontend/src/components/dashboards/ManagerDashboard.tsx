'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi, teamApi } from '../../lib/api';
import {
  DashboardHeader, DashboardSkeleton, KpiCard, SectionCard, BarRow, PersonAvatar,
  ChartTooltip, EmptyBlock, CountPill, FilterSelect,
} from './DashboardUI';
import { useChartTheme } from '../../hooks/useChartTheme';
import { useDashboardSSE } from '../../hooks/useDashboardRefresh';
import { useUserRole } from '../../lib/rbac';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell,
} from 'recharts';
import { startOfWeek, startOfMonth, subDays, startOfQuarter, format } from 'date-fns';
import { TrendingUp, Users, BadgeCheck, Trophy, Clock, Medal, BarChart3, CalendarCheck, UserCheck, CalendarRange, Filter as FunnelIcon, AlertTriangle } from 'lucide-react';
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
  const ct = useChartTheme();

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
    return <DashboardSkeleton kpis={4} />;
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
    { key: 'new', label: 'Generated', count: teamLeadsTotal, color: ct.series[0] },
    { key: 'contacted', label: 'Contacted', count: contactedCount, color: ct.series[1] },
    { key: 'qualified', label: 'Qualified', count: qualifiedCount, color: ct.series[2] },
    { key: 'closed_won', label: 'Closed won', count: closedWonCount, color: ct.series[5] },
  ];
  const funnelMax = Math.max(...funnelData.map((f) => f.count), 1);

  // Exec leaderboard â€” top 3 by lead count within date range
  const leaderboard = [...execList]
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, 3)
    .map((e) => {
      const conv = convList.find((c) => c.user?.id === e.user?.id);
      return {        id: e.user?.id ?? e.user?.name ?? Math.random().toString(),        name: e.user?.name ?? '—',
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

  const EXEC_BAR_COLORS = [ct.series[0], ct.series[1], ct.series[2], ct.series[5], ct.series[6], ct.series[7]];
  const STATUS_PILL: Record<string, string> = {
    new: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    contacted: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    qualified: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  };
  const RANK_STYLE = [
    'bg-gradient-to-br from-amber-300 to-yellow-500 text-amber-950 shadow-md shadow-amber-500/30',
    'bg-gradient-to-br from-slate-200 to-slate-400 text-slate-800 shadow-md shadow-slate-400/30',
    'bg-gradient-to-br from-orange-300 to-orange-600 text-orange-950 shadow-md shadow-orange-500/30',
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <DashboardHeader title="Team Dashboard" subtitle={DATE_PRESET_LABELS[datePreset]}>
        {executives.length > 0 && (
          <FilterSelect icon={UserCheck} tone="emerald"
            value={selectedExecId}
            onChange={(e) => setSelectedExecId(e.target.value)}
            aria-label="Filter by executive"
          >
            <option value="">All executives</option>
            {executives.map((exec: any) => (
              <option key={exec.id} value={exec.id}>{exec.name}</option>
            ))}
          </FilterSelect>
        )}
        <FilterSelect icon={CalendarRange} tone="blue"
          value={datePreset}
          onChange={(e) => setDatePreset(e.target.value)}
          aria-label="Date range"
        >
          <option value="this_week">This week</option>
          <option value="this_month">This month</option>
          <option value="last_30">Last 30 days</option>
          <option value="this_quarter">This quarter</option>
        </FilterSelect>
      </DashboardHeader>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Users} tone="blue" label="Team leads" value={teamLeadsTotal.toLocaleString()}>
          {DATE_PRESET_LABELS[datePreset]}
        </KpiCard>
        <KpiCard icon={BadgeCheck} tone="violet" label="Qualified" value={qualifiedCount}>
          {qualRate}% qualification rate
        </KpiCard>
        <KpiCard icon={Trophy} tone="emerald" label="Closed / won" value={closedWonCount}>
          <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
            <TrendingUp size={13} /> {DATE_PRESET_LABELS[datePreset]}
          </span>
        </KpiCard>
        <KpiCard icon={Clock} tone={pendingFollowUps > 0 ? 'rose' : 'amber'} label="Overdue follow-ups" value={pendingFollowUps}>
          {pendingFollowUps > 0 ? (
            <span className="font-medium text-rose-600 dark:text-rose-400">{pendingFollowUps} need attention</span>
          ) : null}
        </KpiCard>
      </div>

      {/* Middle Row: Pipeline Funnel + Exec Leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Pipeline funnel" subtitle={DATE_PRESET_LABELS[datePreset]} icon={FunnelIcon} tone="indigo">
          <div className="space-y-5">
            {funnelData.map((stage) => (
              <BarRow
                key={stage.key}
                label={stage.label}
                count={stage.count.toLocaleString()}
                pct={(stage.count / funnelMax) * 100}
                barColor={stage.color}
              />
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Exec leaderboard" subtitle={DATE_PRESET_LABELS[datePreset]} icon={Medal} tone="amber">
          {leaderboard.length === 0 ? (
            <EmptyBlock icon={Medal} message="No exec data for this period" />
          ) : (
            <div className="-mx-2 space-y-1">
              {leaderboard.map((exec, i) => (
                <div key={exec.id} className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-gradient-to-r hover:from-amber-50 hover:to-transparent dark:hover:from-amber-500/[0.08] transition-colors duration-150">
                  <span className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold tabular-nums flex-shrink-0 ${RANK_STYLE[i] ?? 'bg-slate-400/10 text-slate-500'}`}>
                    #{i + 1}
                  </span>
                  <PersonAvatar name={exec.name} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-ink truncate">{exec.name}</p>
                    <p className="text-xs text-ink-3">
                      {exec.leads} leads &middot; {exec.closed} closed
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Lower Row: Lead count by exec + Overdue follow-ups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Lead count by exec" subtitle={DATE_PRESET_LABELS[datePreset]} icon={BarChart3} tone="blue">
          {execBarData.length === 0 ? (
            <EmptyBlock icon={BarChart3} message="No leads in this period" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={execBarData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={ct.grid} />
                <XAxis dataKey="name" tick={ct.tick} axisLine={false} tickLine={false} />
                <YAxis tick={ct.tick} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip cursor={ct.cursor} content={<ChartTooltip suffix=" leads" />} />
                <Bar dataKey="leads" radius={[6, 6, 0, 0]} maxBarSize={36} animationDuration={500}>
                  {execBarData.map((_, idx) => (
                    <Cell key={idx} fill={EXEC_BAR_COLORS[idx % EXEC_BAR_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard
          title="Overdue follow-ups"
          icon={AlertTriangle}
          tone="rose"
          action={overdueLeads.length > 0 ? <CountPill>{overdueLeads.length}</CountPill> : undefined}
        >
          {overdueLeads.length === 0 ? (
            <EmptyBlock icon={CalendarCheck} message="No overdue follow-ups" />
          ) : (
            <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
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
                    onKeyDown={(e) => { if (e.key === 'Enter' && lead.id) router.push(`/dashboard/leads/${lead.id}`); }}
                    role="button"
                    tabIndex={0}
                    className="group relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 pl-4 pr-3 py-3 rounded-xl border border-rose-100 dark:border-rose-500/15 bg-gradient-to-r from-rose-50/80 to-white dark:from-rose-500/[0.08] dark:to-surface-2 hover:border-rose-300 dark:hover:border-rose-500/30 hover:-translate-y-px transition-all duration-150 cursor-pointer overflow-hidden"
                  >
                    <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-rose-500/80" />
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-[13px] font-semibold text-ink truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{lead.companyName}</p>
                      <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium flex-shrink-0 ${STATUS_PILL[lead.status] ?? 'bg-slate-400/10 text-slate-600 dark:text-slate-400'}`}>
                        {lead.status?.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                      </span>
                    </div>
                    <p className="text-xs text-ink-3 mb-2">
                      Assigned to {lead.assignedTo?.name ?? 'Unassigned'} ·{' '}
                      <span className="font-medium text-rose-600 dark:text-rose-400">
                        {days > 0 ? `${days} day${days !== 1 ? 's' : ''} overdue` : 'Due today'}
                      </span>
                    </p>
                    <span className="badge bg-slate-100 dark:bg-slate-400/[0.08] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-400/[0.12]">
                      {srcLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
