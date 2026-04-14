"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { analyticsApi } from "../../../lib/api";
import { StatCard, ProgressBar, Spinner } from "../../../components/ui";
import { Users, Mail, TrendingUp, Calendar, RefreshCw } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-xs">
      <p className="text-slate-400 mb-1">{label}</p>
      <p className="font-bold text-blue-300">{payload[0].value} leads</p>
    </div>
  );
};

export default function AnalyticsPage() {
  const queryClient = useQueryClient();

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
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="text-sm text-slate-500 mt-1">
            AI-powered sales performance insights
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="btn-ghost p-2"
          title="Refresh analytics"
        >
          <RefreshCw
            size={15}
            className={overviewFetching ? "animate-spin" : ""}
          />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total Leads"
          value={overview?.totalLeads?.toLocaleString() ?? "—"}
          delta={`+${overview?.leadsToday ?? 0} today`}
          icon={Users}
        />
        <StatCard
          label="Emails Sent"
          value={overview?.emailsSent?.toLocaleString() ?? "—"}
          delta={
            overview?.emailsToday != null
              ? `+${overview.emailsToday} today`
              : undefined
          }
          icon={Mail}
        />
        <StatCard
          label="Reply Rate"
          value={
            overview?.replyRate != null ? `${overview.replyRate}%` : "0.0%"
          }
          delta={
            overview?.replyRateChange != null
              ? `${overview.replyRateChange >= 0 ? "↑" : "↓"} this week`
              : "↑ this week"
          }
          icon={TrendingUp}
        />
        <StatCard
          label="Meetings Booked"
          value={overview?.meetingsBooked ?? "—"}
          delta={`+${overview?.meetingsToday ?? 0} today`}
          icon={Calendar}
        />
      </div>

      {/* Bar Chart */}
      <div className="card p-6">
        <h2 className="section-title mb-6">Leads Discovered (Monthly)</h2>
        {monthlyData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthlyData} barCategoryGap="30%">
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(100,116,139,0.15)"
              />
              <XAxis
                dataKey="month"
                tick={{ fill: "#475569", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#475569", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" fill="url(#barGrad)" radius={[4, 4, 0, 0]} />
              <defs>
                <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" />
                  <stop offset="100%" stopColor="#06b6d4" />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-40 flex items-center justify-center text-slate-600 text-sm">
            No data yet — run scans to populate analytics
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-5">
          <h2 className="section-title mb-4">Lead Quality Distribution</h2>
          <div className="space-y-4">
            {[
              { label: "🔥 Hot Leads", key: "hot", color: "amber" },
              { label: "🟡 Warm Leads", key: "warm", color: "amber" },
              { label: "❄️ Cold Leads", key: "cold", color: "blue" },
            ].map(({ label, key, color }) => {
              const total = overview?.totalLeads ?? 0;
              const count = overview?.[`${key}Leads`] ?? 0;
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={key}>
                  <div className="flex justify-between mb-1.5 text-xs">
                    <span className="text-slate-400">{label}</span>
                    <span className="font-semibold text-slate-600 dark:text-slate-300">{pct}%</span>
                  </div>
                  <ProgressBar value={pct} color={color as any} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="section-title mb-4">Top Signal Sources</h2>
          {sourcesData.length > 0 ? (
            <div className="space-y-4">
              {sourcesData.slice(0, 5).map((s: any) => (
                <div key={s.source}>
                  <div className="flex justify-between mb-1.5 text-xs">
                    <span className="text-slate-400">{s.source}</span>
                    <span className="font-semibold text-slate-600 dark:text-slate-300">
                      {s.count}
                    </span>
                  </div>
                  <ProgressBar
                    value={s.count}
                    max={sourcesData[0]?.count ?? 1}
                    color="blue"
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-600 text-center py-6">
              No source data yet
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
