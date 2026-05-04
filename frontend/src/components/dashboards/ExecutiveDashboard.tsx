'use client';

import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../../lib/api';
import { Spinner } from '../../components/ui';
import { useDashboardSSE } from '../../hooks/useDashboardRefresh';
import { useUserRole } from '../../lib/rbac';
import { TrendingUp, Zap, PlusCircle, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  new: { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/25' },
  contacted: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/25' },
  qualified: { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/25' },
  closed_won: { bg: 'bg-violet-500/15', text: 'text-violet-400', border: 'border-violet-500/25' },
  closed_lost: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/25' },
  replied: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', border: 'border-cyan-500/25' },
  meeting_booked: { bg: 'bg-pink-500/15', text: 'text-pink-400', border: 'border-pink-500/25' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] ?? { bg: 'bg-slate-500/15', text: 'text-slate-400', border: 'border-slate-500/25' };
  const label = status?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ?? '—';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${s.bg} ${s.text} ${s.border}`}>
      {label}
    </span>
  );
}

const LEAD_TYPE_LABELS: Record<string, string> = {
  position_discovery: 'Position discovery',
  product_discovery: 'Product discovery',
  manual: 'Manual entry',
};

const STATUS_BAR_COLORS: Record<string, string> = {
  new: 'bg-blue-500',
  contacted: 'bg-emerald-500',
  qualified: 'bg-amber-500',
  closed_won: 'bg-violet-500',
};

function timeStr(dateStr: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function daysOverdue(dateStr: string) {
  if (!dateStr) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000));
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
    return <div className="flex items-center justify-center h-64"><Spinner size={24} /></div>;
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
  const followUpsTodayCount = followUpsToday.length + overdueCount;

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

  // All follow-ups: overdue first (red), then today (amber/blue)
  const allFollowUps = [
    ...overdueFollowUps.map((f) => ({ ...f, _overdue: true })),
    ...followUpsToday.filter(
      (f) => !overdueFollowUps.find((o) => o.id === f.id)
    ).map((f) => ({ ...f, _overdue: false })),
  ];

  return (
    <div className="space-y-6">
      {/* Role Tag */}
      {/* <div>
        <span className="text-xs bg-amber-500/15 border border-amber-500/25 text-amber-400 px-3 py-1 rounded-full font-medium">
          Lead generation exec
        </span>
      </div> */}

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-5">
          <p className="text-xs text-slate-500 mb-1">My leads</p>
          <p className="text-2xl font-bold text-slate-100">{totalMyLeads}</p>
          <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
            <TrendingUp size={10} /> +{leadsThisWeek} this week
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-slate-500 mb-1">Closed / won</p>
          <p className="text-2xl font-bold text-slate-100">{closedWonCount}</p>
          <p className="text-xs text-slate-500 mt-1">{closeRate}% close rate</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-slate-500 mb-1">Follow-ups today</p>
          <p className="text-2xl font-bold text-slate-100">{followUpsTodayCount}</p>
          {overdueCount > 0 ? (
            <p className="text-xs text-red-400 mt-1">{overdueCount} overdue</p>
          ) : (
            <p className="text-xs text-slate-600 mt-1">&nbsp;</p>
          )}
        </div>
      </div>

      {/* Middle Row: My leads list + right column */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* My leads list */}
        <div className="card p-5">
          <h2 className="section-title mb-4">My leads</h2>
          {myLeads.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">No leads assigned yet</p>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {myLeads.map((lead: any) => (
                <div key={lead.id} className="p-3 rounded-xl border border-white/[0.06] hover:border-white/[0.10] hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <Link
                      href={`/dashboard/leads/${lead.id}`}
                      className="text-sm font-medium text-slate-200 hover:text-blue-400 transition-colors truncate"
                    >
                      {lead.companyName}
                    </Link>
                    <StatusBadge status={lead.status} />
                  </div>
                  <p className="text-xs text-slate-500 mb-2.5">
                    {[lead.industry, lead.location, lead.contactName].filter(Boolean).join(' · ')}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-md border border-white/[0.06] text-slate-400">
                      {LEAD_TYPE_LABELS[lead.source ?? ''] ?? lead.source ?? 'Manual entry'}
                    </span>
                    <button
                      onClick={() => router.push(`/dashboard/leads/${lead.id}`)}
                      className="ml-auto text-xs font-medium px-3 py-1 rounded-lg border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-colors"
                    >
                      Update status
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column: status breakdown + follow-ups as separate cards */}
        <div className="space-y-4">
          {/* My status breakdown */}
          <div className="card p-5">
            <h2 className="section-title mb-5">My status breakdown</h2>
            <div className="space-y-4">
              {statusRows.map((row) => {
                const count = statusBreakdown[row.key] ?? 0;
                return (
                  <div key={row.key} className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-slate-400">{row.label}</span>
                        <span className="text-slate-300 font-semibold">{count}</span>
                      </div>
                      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ease-out ${STATUS_BAR_COLORS[row.key] ?? 'bg-blue-500'}`}
                          style={{ width: `${(count / maxStatus) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Today's follow-ups */}
          <div className="card p-5">
            <h2 className="section-title mb-3">Today's follow-ups</h2>
            {allFollowUps.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-3">No follow-ups scheduled</p>
            ) : (
              <div className="space-y-2">
                {allFollowUps.slice(0, 5).map((f: any, i: number) => {
                  const overdue = f._overdue;
                  const days = overdue ? daysOverdue(f.followUpDate) : 0;
                  const timeLabel = overdue
                    ? `Overdue${days > 0 ? ` · was ${timeStr(f.followUpDate)}` : ''}`
                    : `Due ${timeStr(f.followUpDate || f.expectedCloseDate)}`;
                  return (
                    <div
                      key={f.id || i}
                      onClick={() => f.id && router.push(`/dashboard/leads/${f.id}`)}
                      className={`flex items-center gap-3 p-2.5 rounded-lg border text-xs transition-colors ${
                        f.id ? 'cursor-pointer' : ''
                      } ${
                        overdue
                          ? 'border-red-500/20 bg-red-500/5 hover:bg-red-500/10'
                          : i % 2 === 0
                            ? 'border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10'
                            : 'border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10'
                      }`}
                    >
                      <div
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          overdue ? 'bg-red-400' : i % 2 === 0 ? 'bg-amber-400' : 'bg-blue-400'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-300 font-medium truncate">
                          {f.companyName ?? f.title ?? '—'}
                        </p>
                        <p className={`mt-0.5 ${overdue ? 'text-red-400' : 'text-slate-500'}`}>
                          {timeLabel}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      {/* <div className="card p-5">
        <h2 className="section-title mb-4">Quick actions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => router.push('/dashboard/lead-discovery')}
            className="btn-ghost text-sm"
          >
            <Zap size={14} /> Generate leads ↗
          </button>
          <button
            onClick={() => router.push('/dashboard/leads/new')}
            className="btn-ghost text-sm"
          >
            <PlusCircle size={14} /> Add lead manually ↗
          </button>
          <button
            onClick={() => router.push('/dashboard/lead-discovery?tab=product')}
            className="btn-ghost text-sm"
          >
            <Search size={14} /> Product discovery ↗
          </button>
        </div>
      </div> */}
    </div>
  );
}



