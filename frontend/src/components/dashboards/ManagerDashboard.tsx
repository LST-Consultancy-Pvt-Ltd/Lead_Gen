'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../../lib/api';
import { Spinner } from '../../components/ui';
import { WidgetGrid, DateFilterBar, type DashboardWidget } from './DashboardWidgets';
import { startOfWeek, startOfMonth, subDays, startOfQuarter, format } from 'date-fns';
import { useDashboardSSE } from '../../hooks/useDashboardRefresh';
import { useUserRole } from '../../lib/rbac';

// ── Date Range Helper (shared with AdminDashboard) ─────────────────────────
export function getDateRange(preset: string) {
  const now = new Date();
  switch (preset) {
    case 'this_week':
      return { startDate: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'), endDate: format(now, 'yyyy-MM-dd') };
    case 'this_month':
      return { startDate: format(startOfMonth(now), 'yyyy-MM-dd'), endDate: format(now, 'yyyy-MM-dd') };
    case 'last_30':
      return { startDate: format(subDays(now, 30), 'yyyy-MM-dd'), endDate: format(now, 'yyyy-MM-dd') };
    case 'this_quarter':
      return { startDate: format(startOfQuarter(now), 'yyyy-MM-dd'), endDate: format(now, 'yyyy-MM-dd') };
    default:
      return {};
  }
}

/**
 * Flattens { leads: [], opportunities: [] } into a single array.
 */
function flattenFollowUps(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const leads = Array.isArray(raw.leads) ? raw.leads : [];
    const opps = Array.isArray(raw.opportunities) ? raw.opportunities : [];
    return [...leads, ...opps];
  }
  return [];
}

/**
 * Normalizes manager API response → DashboardWidget[].
 * Field names match the actual backend /analytics/dashboard/manager response.
 */
export function buildManagerWidgets(data: any): DashboardWidget[] {
  // Backend-driven: if the API already sends a widgets array, return it directly
  if (Array.isArray(data?.widgets)) {
    return data.widgets as DashboardWidget[];
  }

  const widgets: DashboardWidget[] = [];

  // ── leadsByExecutive: [{ user: { id, name, email }, count }] ──
  const leadsByExec = Array.isArray(data?.leadsByExecutive) ? data.leadsByExecutive : [];
  // ── conversionRateByExecutive: [{ user: { name }, total, converted, rate }] ──
  const convByExec = Array.isArray(data?.conversionRateByExecutive) ? data.conversionRateByExecutive : [];

  // ── Widget 1: Revenue closed (period) ────────────────────────
  // Backend sends { totalValue, dealCount } or just a number
  const revenueClosedRaw = data?.revenueClosed;
  const revenueClosedVal = typeof revenueClosedRaw === 'object'
    ? (revenueClosedRaw?.totalValue ?? 0)
    : (revenueClosedRaw ?? data?.totalRevenueClosed ?? 0);
  const revenueClosedSub = typeof revenueClosedRaw === 'object' && revenueClosedRaw?.dealCount != null
    ? `${revenueClosedRaw.dealCount} deal${revenueClosedRaw.dealCount === 1 ? '' : 's'} closed`
    : undefined;
  widgets.push({
    id: 'revenue_closed',
    type: 'currency_card',
    title: 'Revenue closed (period)',
    description: revenueClosedSub ?? 'Total deal value of Closed Won in selected period',
    icon: 'dollar',
    color: 'emerald',
    layout: 'half',
    data: { value: revenueClosedVal },
  });

  // ── Widget 2: Revenue forecast (weighted) ────────────────────
  // Backend sends { weightedValue, openDeals } or just a number
  const forecastRaw = data?.revenueForecast;
  const forecastVal = typeof forecastRaw === 'object'
    ? (forecastRaw?.weightedValue ?? 0)
    : (forecastRaw ?? data?.weightedForecast ?? 0);
  const forecastSub = typeof forecastRaw === 'object' && forecastRaw?.openDeals != null
    ? `${forecastRaw.openDeals} open deal${forecastRaw.openDeals === 1 ? '' : 's'}`
    : undefined;
  widgets.push({
    id: 'revenue_forecast',
    type: 'currency_card',
    title: 'Revenue forecast (weighted)',
    description: forecastSub ?? 'SUM(deal_value × probability) of open opportunities',
    icon: 'trending_up',
    color: 'violet',
    layout: 'half',
    data: { value: forecastVal },
  });

  // ── Widget 3: Leads by executive (bar chart) ─────────────────
  widgets.push({
    id: 'leads_by_executive',
    type: 'bar_chart',
    title: 'Leads by Executive',
    icon: 'bar_chart',
    color: 'blue',
    layout: 'half',
    data: {
      items: leadsByExec.map((e: any) => ({
        name: e.user?.name || e.executiveName || e.name || '—',
        value: e.count ?? e.leadCount ?? e.total ?? 0,
      })),
      dataKey: 'value',
      nameKey: 'name',
      barColor: '#3b82f6',
      barLabel: 'Leads',
    },
  });

  // ── Widget 4: Conversion rate by executive ───────────────────
  widgets.push({
    id: 'conversion_by_executive',
    type: 'bar_chart',
    title: 'Conversion Rate by Executive',
    icon: 'target',
    color: 'emerald',
    layout: 'half',
    data: {
      items: convByExec.map((e: any) => ({
        name: e.user?.name || e.executiveName || e.name || '—',
        value: Number(e.rate ?? e.conversionRate ?? 0),
      })),
      dataKey: 'value',
      nameKey: 'name',
      barColor: '#10b981',
      barLabel: 'Conversion Rate',
      isPercentage: true,
    },
  });

  // ── Widget 5: Pipeline by stage ──────────────────────────────
  const pipelineByStage = Array.isArray(data?.pipelineByStage ?? data?.pipeline)
    ? (data?.pipelineByStage ?? data?.pipeline)
    : [];
  widgets.push({
    id: 'pipeline_by_stage',
    type: 'pipeline_chart',
    title: 'Pipeline by Stage',
    description: 'count + deal value',
    icon: 'bar_chart',
    color: 'violet',
    layout: 'full',
    data: { items: pipelineByStage },
  });

  // ── Widget 6: Stuck deals ────────────────────────────────────
  // Backend: [{ title, stage, stageChangedAt, assignedTo: { name }, lead: { companyName } }]
  const stuckDealsRaw = Array.isArray(data?.stuckDeals) ? data.stuckDeals : [];
  const stuckDeals = stuckDealsRaw.map((deal: any) => {
    const changedAt = deal.stageChangedAt || deal.updatedAt;
    const daysStuck = changedAt
      ? Math.floor((Date.now() - new Date(changedAt).getTime()) / 86_400_000)
      : 0;
    return {
      ...deal,
      opportunityName: deal.title || deal.lead?.companyName || '—',
      currentStage: deal.stage || '—',
      daysStuck,
      ownerName: deal.assignedTo?.name || deal.executiveName || '—',
    };
  });
  widgets.push({
    id: 'stuck_deals',
    type: 'list',
    title: 'Stuck Deals (7+ days in same stage)',
    icon: 'alert',
    color: 'amber',
    layout: 'half',
    data: { items: stuckDeals, variant: 'warning' },
  });

  // ── Widget 7: Loss reason breakdown ──────────────────────────
  const lossReasons = Array.isArray(data?.lossReasonBreakdown ?? data?.lossReasons)
    ? (data?.lossReasonBreakdown ?? data?.lossReasons)
    : [];
  widgets.push({
    id: 'loss_reason_breakdown',
    type: 'pie_chart',
    title: 'Loss Reason Breakdown',
    icon: 'pie_chart',
    color: 'red',
    layout: 'half',
    data: { items: lossReasons },
  });

  // ── Widget 8: Overdue follow-ups (team) ──────────────────────
  // Backend: { leads: [], opportunities: [] } each item has assignedTo: { name }
  const overdueRaw = data?.overdueFollowUps ?? data?.overdueFollowups;
  const overdue = flattenFollowUps(overdueRaw).map((item: any) => ({
    ...item,
    companyName: item.companyName || item.lead?.companyName || item.title || '—',
    executiveName: item.assignedTo?.name || item.executiveName || '—',
    followUpDate: item.followUpDate || item.nextFollowUpDate || item.dueDate || '—',
  }));
  widgets.push({
    id: 'overdue_follow_ups_team',
    type: 'table',
    title: 'Overdue Follow-ups (Team)',
    icon: 'clock',
    color: 'red',
    layout: 'full',
    data: {
      items: overdue,
      showCount: true,
      columns: [
        { key: 'companyName', label: 'Company', color: 'primary' },
        { key: 'executiveName', label: 'Executive' },
        { key: 'followUpDate', label: 'Follow-up Date', color: 'red' },
      ],
    },
  });

  return widgets;
}

// ── Manager Dashboard ──────────────────────────────────────────────────────
export function ManagerDashboard() {
  const role = useUserRole();
  useDashboardSSE(role);

  const [datePreset, setDatePreset] = useState('last_30');
  const params = getDateRange(datePreset);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'manager', datePreset],
    queryFn: () => analyticsApi.getManagerDashboard(params).then((r) => r.data?.data ?? r.data ?? {}),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  const widgets = useMemo(() => buildManagerWidgets(data ?? {}), [data]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Spinner size={24} /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="page-title">Sales Manager Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Team performance &amp; pipeline overview</p>
        </div>
        <span className="text-xs bg-green-500/10 border border-green-500/20 text-green-400 px-3 py-1 rounded-full font-medium">
          Full team visibility
        </span>
      </div>

      <DateFilterBar value={datePreset} onChange={setDatePreset} />
      <WidgetGrid widgets={widgets} />
    </div>
  );
}
