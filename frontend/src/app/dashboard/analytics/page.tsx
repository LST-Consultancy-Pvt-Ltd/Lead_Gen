"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { analyticsApi } from "../../../lib/api";
import { Spinner } from "../../../components/ui";
import { PageHero } from "../../../components/ui/PageHero";
import {
  KpiCard,
  SectionCard,
  BarRow,
  EmptyBlock,
  ChartTooltip,
  chartTick,
  chartGridStroke,
  chartCursor,
} from "../../../components/dashboards/DashboardUI";
import { useChartTheme } from "../../../hooks/useChartTheme";
import {
  Users,
  Mail,
  TrendingUp,
  Calendar,
  RefreshCw,
  BarChart3,
  Radar,
  Gauge,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

export default function AnalyticsPage() {
  const queryClient = useQueryClient();
  const ct = useChartTheme();

  const refetchOptions = {
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  };

  const {
    data: overview,
    isLoading,
    isFetching: overviewFetching,
  } = useQuery({
    queryKey: ["analytics-overview"],
    queryFn: () => analyticsApi.overview().then((r) => r.data.data),
    ...refetchOptions,
  });
  const { data: monthly } = useQuery({
    queryKey: ["analytics-monthly"],
    queryFn: () => analyticsApi.monthly().then((r) => r.data.data),
    ...refetchOptions,
  });
  const { data: sources } = useQuery({
    queryKey: ["analytics-sources"],
    queryFn: () => analyticsApi.topSources().then((r) => r.data.data),
    ...refetchOptions,
  });

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ["analytics-overview"] });
    queryClient.invalidateQueries({ queryKey: ["analytics-monthly"] });
    queryClient.invalidateQueries({ queryKey: ["analytics-sources"] });
  }

  const monthlyData = monthly ?? [];
  const sourcesData: any[] = sources ?? [];

  if (isLoading)
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={24} />
      </div>
    );

  return (
    <div className="space-y-6">
      <PageHero
        icon={BarChart3}
        eyebrow="Insights"
        title="Analytics"
        subtitle="AI-powered sales performance insights"
      >
        <button
          onClick={handleRefresh}
          className="inline-flex items-center gap-2 h-10 px-3.5 rounded-xl text-sm font-medium text-white bg-white/10 ring-1 ring-white/20 backdrop-blur hover:bg-white/20 transition-all"
          title="Refresh analytics"
        >
          <RefreshCw
            size={15}
            className={overviewFetching ? "animate-spin" : ""}
          />
          Refresh
        </button>
      </PageHero>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          icon={Users}
          tone="blue"
          label="Total Leads"
          value={overview?.totalLeads?.toLocaleString() ?? "—"}
        >
          {`+${overview?.leadsToday ?? 0} today`}
        </KpiCard>
        <KpiCard
          icon={Mail}
          tone="violet"
          label="Emails Sent"
          value={overview?.emailsSent?.toLocaleString() ?? "—"}
        >
          {overview?.emailsToday != null
            ? `+${overview.emailsToday} today`
            : undefined}
        </KpiCard>
        <KpiCard
          icon={TrendingUp}
          tone="emerald"
          label="Reply Rate"
          value={
            overview?.replyRate != null ? `${overview.replyRate}%` : "0.0%"
          }
        >
          {overview?.replyRateChange != null
            ? `${overview.replyRateChange >= 0 ? "↑" : "↓"} this week`
            : "↑ this week"}
        </KpiCard>
        <KpiCard
          icon={Calendar}
          tone="amber"
          label="Meetings Booked"
          value={overview?.meetingsBooked ?? "—"}
        >
          {`+${overview?.meetingsToday ?? 0} today`}
        </KpiCard>
      </div>

      {/* Bar Chart */}
      <SectionCard
        title="Leads Discovered (Monthly)"
        subtitle="New leads added per month"
        icon={BarChart3}
        tone="blue"
      >
        {monthlyData.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyData} barCategoryGap="30%">
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={ct.grid}
                vertical={false}
              />
              <XAxis
                dataKey="month"
                tick={ct.tick}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={ct.tick}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<ChartTooltip suffix=" leads" />} cursor={ct.cursor} />
              <Bar dataKey="count" fill="url(#barGrad)" radius={[6, 6, 0, 0]} />
              <defs>
                <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ct.series[1]} />
                  <stop offset="100%" stopColor={ct.series[0]} />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyBlock
            icon={BarChart3}
            message="No data yet — run scans to populate analytics"
            className="h-40"
          />
        )}
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard
          title="Lead Quality Distribution"
          subtitle="Share of total leads by temperature"
          icon={Gauge}
          tone="amber"
        >
          <div className="space-y-5">
            {[
              { label: "Hot Leads", key: "hot", color: "rose" as const },
              { label: "Warm Leads", key: "warm", color: "amber" as const },
              { label: "Cold Leads", key: "cold", color: "cyan" as const },
            ].map(({ label, key, color }) => {
              const total = overview?.totalLeads ?? 0;
              const count = overview?.[`${key}Leads`] ?? 0;
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <BarRow
                  key={key}
                  label={label}
                  count={`${pct}%`}
                  pct={pct}
                  tone={color}
                />
              );
            })}
          </div>
        </SectionCard>

        <SectionCard
          title="Top Signal Sources"
          subtitle="Where your leads come from"
          icon={Radar}
          tone="violet"
        >
          {sourcesData.length > 0 ? (
            <div className="space-y-5">
              {sourcesData.slice(0, 5).map((s: any) => {
                const max = sourcesData[0]?.count ?? 1;
                return (
                  <BarRow
                    key={s.source}
                    label={s.source}
                    count={s.count}
                    pct={max > 0 ? (s.count / max) * 100 : 0}
                    tone="violet"
                  />
                );
              })}
            </div>
          ) : (
            <EmptyBlock icon={Radar} message="No source data yet" />
          )}
        </SectionCard>
      </div>
    </div>
  );
}
