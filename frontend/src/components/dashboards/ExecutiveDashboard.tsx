'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../../lib/api';
import { Spinner } from '../../components/ui';
import { WidgetGrid, type DashboardWidget } from './DashboardWidgets';
import { useDashboardSSE } from '../../hooks/useDashboardRefresh';
import { useUserRole } from '../../lib/rbac';

/**
 * Flattens { leads: [], opportunities: [] } into a single array.
 * Falls back to raw array or empty array for any other shape.
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
 * Normalizes the sales (executive) API response into a DashboardWidget array.
 * Field names match the actual backend /analytics/dashboard/sales response.
 */
function buildExecutiveWidgets(data: any): DashboardWidget[] {
  const widgets: DashboardWidget[] = [];

  // If backend sends a pre-built widgets array, use it directly
  if (Array.isArray(data?.widgets)) {
    return data.widgets as DashboardWidget[];
  }

  // ── Widget 1: My leads today ─────────────────────────────────
  widgets.push({
    id: 'my_leads_today',
    type: 'stat_card',
    title: 'My leads today',
    icon: 'calendar',
    color: 'blue',
    layout: 'half',
    data: { value: data?.leadsToday ?? data?.myLeadsToday ?? 0, tag: 'Count' },
  });

  // ── Widget 2: My leads this week ─────────────────────────────
  widgets.push({
    id: 'my_leads_week',
    type: 'stat_card',
    title: 'My leads this week',
    icon: 'target',
    color: 'violet',
    layout: 'half',
    data: { value: data?.leadsThisWeek ?? data?.myLeadsThisWeek ?? 0, tag: 'Count' },
  });

  // ── Widget 3: Follow-ups due today count ─────────────────────
  const followupsToday = flattenFollowUps(data?.followUpsDueToday);
  widgets.push({
    id: 'followups_today_count',
    type: 'stat_card',
    title: 'Follow-ups due today',
    icon: 'alert',
    color: 'amber',
    layout: 'half',
    data: { value: followupsToday.length, tag: 'Count' },
  });

  // ── Widget 4: My conversion rate ─────────────────────────────
  const convData = data?.conversionRateLast30Days;
  const convRate = convData?.rate ?? data?.myConversionRate ?? 0;
  const convSubtitle = convData
    ? `${convData.converted ?? 0} of ${convData.total ?? 0} leads converted`
    : 'Last 30 days';
  widgets.push({
    id: 'my_conversion_rate',
    type: 'stat_card',
    title: 'My conversion rate',
    description: convSubtitle,
    icon: 'trending_up',
    color: 'emerald',
    layout: 'half',
    data: { value: Number(convRate).toFixed(1), suffix: '%', tag: '%', subtitle: convSubtitle },
  });

  // ── Widget 5: Follow-ups due today (list) ────────────────────
  // Map leadId: item.id for each item
  const followUpItems = followupsToday.map((item: any) => ({
    ...item,
    leadId: item.leadId ?? item.id,
  }));
  widgets.push({
    id: 'follow_ups_due_today',
    type: 'list',
    title: 'Follow-ups Due Today',
    icon: 'calendar',
    color: 'amber',
    layout: 'half',
    data: { items: followUpItems, variant: 'follow_up' },
  });

  // ── Widget 6: Overdue follow-ups ─────────────────────────────
  const overdue = flattenFollowUps(data?.overdueFollowUps ?? data?.overdueFollowups);
  const overdueItems = overdue.map((item: any) => ({
    ...item,
    leadId: item.leadId ?? item.id,
  }));
  widgets.push({
    id: 'overdue_follow_ups',
    type: 'list',
    title: 'Overdue Follow-ups',
    icon: 'alert',
    color: 'red',
    layout: 'half',
    data: { items: overdueItems, variant: 'danger' },
  });

  // ── Widget 7: My open opportunities by stage ─────────────────
  const openByStage = Array.isArray(data?.openOpportunitiesByStage)
    ? data.openOpportunitiesByStage
    : Array.isArray(data?.myOpenOpportunitiesByStage)
      ? data.myOpenOpportunitiesByStage
      : [];
  widgets.push({
    id: 'open_opportunities_by_stage',
    type: 'pipeline_chart',
    title: 'My Open Opportunities',
    description: 'by stage',
    icon: 'dollar',
    color: 'emerald',
    layout: 'full',
    data: { items: openByStage },
  });

  return widgets;
}

export function ExecutiveDashboard() {
  const role = useUserRole();
  useDashboardSSE(role);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'sales'],
    queryFn: () => analyticsApi.getSalesDashboard().then((r) => r.data?.data ?? r.data ?? {}),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  const widgets = useMemo(() => buildExecutiveWidgets(data ?? {}), [data]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Spinner size={24} /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="page-title">My Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Your leads, activities &amp; opportunities — personal view</p>
        </div>
        <span className="text-xs bg-blue-500/10 border border-blue-500/20 text-blue-400 px-3 py-1 rounded-full font-medium">
          Own records only
        </span>
      </div>

      <WidgetGrid widgets={widgets} />
    </div>
  );
}

