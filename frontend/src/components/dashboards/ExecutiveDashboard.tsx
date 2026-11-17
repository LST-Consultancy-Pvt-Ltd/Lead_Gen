'use client';

import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../../lib/api';
import { DashboardHeader, DashboardSkeleton, KpiCard, SectionCard, BarRow, EmptyBlock } from './DashboardUI';
import { FollowUpCalendar } from './FollowUpCalendar';
import { useDashboardSSE } from '../../hooks/useDashboardRefresh';
import { useUserRole } from '../../lib/rbac';
import { TrendingUp, Users, Trophy, Clock, Inbox, AlertTriangle, IndianRupee, ArrowUpRight, Briefcase, PieChart } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  contacted: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  qualified: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  closed_won: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  closed_lost: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  replied: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  meeting_booked: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] ?? 'bg-slate-400/10 text-slate-600 dark:text-slate-400';
  const label = status?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ?? '—';
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium flex-shrink-0 ${s}`}>
      {label}
    </span>
  );
}

const LEAD_TYPE_LABELS: Record<string, string> = {
  position_discovery: 'Position discovery',
  product_discovery: 'Product discovery',
  manual: 'Manual entry',
};

const STATUS_BAR_COLORS: Record<string, 'blue' | 'indigo' | 'violet' | 'emerald'> = {
  new: 'blue',
  contacted: 'indigo',
  qualified: 'violet',
  closed_won: 'emerald',
};

/** Short Indian-format money, e.g. ₹42.6L / ₹8.9Cr. */
function formatMoney(value: number) {
  if (!value) return '₹0';
  if (value >= 10_000_000) return `₹${(value / 10_000_000).toFixed(1)}Cr`;
  if (value >= 100_000) return `₹${(value / 100_000).toFixed(1)}L`;
  if (value >= 1_000) return `₹${(value / 1_000).toFixed(1)}K`;
  return `₹${Math.round(value)}`;
}

// ── Component ──────────────────────────────────────────────────────────────

export function ExecutiveDashboard() {
  const role = useUserRole();
  useDashboardSSE(role);
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'sales'],
    queryFn: () => analyticsApi.getSalesDashboard().then((r) => r.data?.data ?? r.data ?? {}),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  if (isLoading) {
    return <DashboardSkeleton kpis={3} />;
  }

  // ── Data derivations ─────────────────────────────────────────
  const totalMyLeads: number = data?.totalMyLeads ?? Object.values((data?.statusBreakdown ?? {}) as Record<string, number>).reduce((a, b) => a + b, 0);
  const leadsThisWeek: number = data?.leadsThisWeek ?? 0;

  const convData = data?.conversionRateLast30Days;
  const closedWonCount: number = data?.statusBreakdown?.closed_won ?? convData?.converted ?? 0;
  const totalLeads: number = convData?.total ?? 0;
  const closeRate = totalLeads > 0 ? ((closedWonCount / totalLeads) * 100).toFixed(0) : '0';

  const followUpsToday: any[] = (() => {
    const raw = data?.followUpsDueToday;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    return [...(raw.leads ?? []), ...(raw.opportunities ?? [])];
  })();

  const overdueFollowUps: any[] = (() => {
    const raw = data?.overdueFollowUps;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    return [...(raw.leads ?? []), ...(raw.opportunities ?? [])];
  })();

  const overdueCount = overdueFollowUps.length;
  const followUpsTodayCount = followUpsToday.length;

  // Open pipeline value across all stages
  const pipelineValue: number = (data?.openOpportunitiesByStage ?? [])
    .reduce((sum: number, s: any) => sum + (s.totalValue ?? 0), 0);
  const openDeals: number = (data?.openOpportunitiesByStage ?? [])
    .reduce((sum: number, s: any) => sum + (s.count ?? 0), 0);

  // myLeads from new backend field
  const myLeads: any[] = Array.isArray(data?.myLeads) ? data.myLeads : [];

  // Status breakdown
  const statusBreakdown = data?.statusBreakdown ?? {};
  const statusRows = [
    { key: 'new', label: 'New' },
    { key: 'contacted', label: 'Contacted' },
    { key: 'qualified', label: 'Qualified' },
    { key: 'closed_won', label: 'Closed' },
  ];
  const maxStatus = Math.max(...statusRows.map((r) => statusBreakdown[r.key] ?? 0), 1);

  return (
    <div className="space-y-6">
      <DashboardHeader title="My Dashboard" />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard icon={Users} tone="blue" label="My leads" value={totalMyLeads} href="/dashboard/leads">
          <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
            <TrendingUp size={13} /> +{leadsThisWeek}
            <span className="font-normal text-ink-3">this week</span>
          </span>
        </KpiCard>
        <KpiCard icon={Trophy} tone="emerald" label="Closed / won" value={closedWonCount} href="/dashboard/leads?status=closed_won">
          {closeRate}% close rate
        </KpiCard>
        <KpiCard icon={Clock} tone="amber" label="Follow-ups today" value={followUpsTodayCount} href="/dashboard/leads?followUp=today">
          Calls, emails and meetings
        </KpiCard>
        <KpiCard icon={AlertTriangle} tone={overdueCount > 0 ? 'rose' : 'emerald'} label="Overdue" value={overdueCount} href="/dashboard/leads?followUp=overdue">
          {overdueCount > 0 ? (
            <span className="font-medium text-rose-600 dark:text-rose-400">Needs attention today</span>
          ) : (
            'All caught up'
          )}
        </KpiCard>
        <KpiCard icon={IndianRupee} tone="violet" label="My pipeline" value={formatMoney(pipelineValue)} href="/dashboard/opportunities">
          {openDeals} open {openDeals === 1 ? 'opportunity' : 'opportunities'}
        </KpiCard>
      </div>

      {/* Follow-up calendar */}
      <FollowUpCalendar scopeLabel="My follow-ups" />

      {/* My leads list + status breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* My leads list */}
        <SectionCard title="My leads" icon={Briefcase} tone="blue">
          {myLeads.length === 0 ? (
            <EmptyBlock icon={Inbox} message="No leads assigned yet" />
          ) : (
            <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
              {myLeads.map((lead: any) => (
                <div key={lead.id} className="p-3.5 rounded-xl border border-line bg-gradient-to-br from-white to-slate-50/60 dark:from-surface-2 dark:to-surface hover:border-blue-300 dark:hover:border-blue-500/30 hover:shadow-md hover:shadow-blue-500/5 transition-all duration-150">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <Link
                      href={`/dashboard/leads/${lead.id}`}
                      className="text-[13px] font-semibold text-ink hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate"
                    >
                      {lead.companyName}
                    </Link>
                    <StatusBadge status={lead.status} />
                  </div>
                  <p className="text-xs text-ink-3 mb-3 truncate">
                    {[lead.industry, lead.location, lead.contactName].filter(Boolean).join(' · ')}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="badge bg-slate-100 dark:bg-slate-400/[0.08] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-400/[0.12]">
                      {LEAD_TYPE_LABELS[lead.source ?? ''] ?? lead.source ?? 'Manual entry'}
                    </span>
                    <button
                      onClick={() => router.push(`/dashboard/leads/${lead.id}`)}
                      className="ml-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-500/[0.06] hover:bg-blue-500/10 border border-blue-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 transition-colors duration-150"
                    >
                      Update status <ArrowUpRight size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Right column: status breakdown + follow-ups as separate cards */}
        <div className="space-y-4">
          <SectionCard title="My status breakdown" icon={PieChart} tone="violet">
            <div className="space-y-5">
              {statusRows.map((row) => {
                const count = statusBreakdown[row.key] ?? 0;
                return (
                  <BarRow
                    key={row.key}
                    label={row.label}
                    count={count}
                    pct={(count / maxStatus) * 100}
                    tone={STATUS_BAR_COLORS[row.key] ?? 'blue'}
                    href={`/dashboard/leads?status=${encodeURIComponent(row.key)}`}
                  />
                );
              })}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
