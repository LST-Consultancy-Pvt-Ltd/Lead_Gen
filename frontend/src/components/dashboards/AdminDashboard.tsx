"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { analyticsApi, usersApi } from "../../lib/api";
import {
  DashboardHeader,
  DashboardSkeleton,
  KpiCard,
  SectionCard,
  BarRow,
  PersonAvatar,
  ChartTooltip,
  EmptyBlock,
  FilterSelect,
  chartTick,
  chartGridStroke,
  chartCursor,
} from "./DashboardUI";
import { useChartTheme } from "../../hooks/useChartTheme";
import { useDashboardSSE } from "../../hooks/useDashboardRefresh";
import { useUserRole } from "../../lib/rbac";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Users,
  UserCheck,
  CalendarRange,
  Percent,
  PieChart,
  BarChart3,
  Activity,
  Briefcase,
} from "lucide-react";
import { useRouter } from "next/navigation";

// ── Helpers ────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  sales_user: "Lead exec",
  manager: "Sales manager",
  org_admin: "Admin",
  super_admin: "Super admin",
};

const LEAD_TYPE_LABELS: Record<string, string> = {
  position_discovery: "Position disc.",
  product_discovery: "Product disc.",
  manual: "Manual entry",
};

const LEAD_TYPE_COLORS: Record<string, "blue" | "violet" | "amber"> = {
  position_discovery: "blue",
  product_discovery: "violet",
  manual: "amber",
};

// Timeline dot colour by audit action (presentation only)
function activityDotClass(action: string) {
  const a = (action || "").toLowerCase();
  if (a.includes("creat") || a.includes("add")) return "bg-emerald-500 ring-emerald-500/20";
  if (a.includes("assign")) return "bg-blue-500 ring-blue-500/20";
  if (a.includes("delet") || a.includes("remov") || a.includes("fail")) return "bg-amber-500 ring-amber-500/20";
  return "bg-violet-500 ring-violet-500/20";
}

function timeAgo(dateStr: string) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins !== 1 ? "s" : ""} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

// ── Component ──────────────────────────────────────────────────────────────

export function AdminDashboard() {
  const role = useUserRole();
  useDashboardSSE(role);
  const router = useRouter();
  const ct = useChartTheme();

  const [selectedManagerId, setSelectedManagerId] = useState<string>("");
  const [selectedExecId, setSelectedExecId] = useState<string>("");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("month");

  // Compute dateFrom / dateTo from the selected period
  function getPeriodRange(period: string): { dateFrom: string; dateTo: string } {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (period === "today") {
      return { dateFrom: fmt(today), dateTo: fmt(tomorrow) };
    }
    if (period === "week") {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      return { dateFrom: fmt(weekStart), dateTo: fmt(tomorrow) };
    }
    if (period === "quarter") {
      const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
      const qStart = new Date(now.getFullYear(), qStartMonth, 1);
      return { dateFrom: fmt(qStart), dateTo: fmt(tomorrow) };
    }
    // default: month
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return { dateFrom: fmt(monthStart), dateTo: fmt(tomorrow) };
  }

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "ceo", selectedManagerId, selectedExecId, selectedPeriod],
    queryFn: () => {
      const { dateFrom, dateTo } = getPeriodRange(selectedPeriod);
      const params: Record<string, string> = { dateFrom, dateTo, period: selectedPeriod };
      if (selectedManagerId) params.managerId = selectedManagerId;
      if (selectedExecId) params.executiveId = selectedExecId;
      return analyticsApi
        .getCEODashboard(params)
        .then((r) => r.data?.data ?? r.data ?? {});
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  const { data: teamList } = useQuery({
    queryKey: ["team", "all"],
    queryFn: () =>
      usersApi.list().then((r) => r.data?.data ?? r.data ?? []),
    staleTime: 60_000,
  });

  if (isLoading) {
    return <DashboardSkeleton kpis={4} />;
  }

  // ── KPI derivations ──────────────────────────────────────────
  const execList = Array.isArray(data?.leadsByExecutive)
    ? data.leadsByExecutive
    : [];
  const convList = Array.isArray(data?.conversionRateByExecutive)
    ? data.conversionRateByExecutive
    : [];
  const totalLeads =
    data?.kpis?.totalLeads ??
    execList.reduce((s: number, e: any) => s + (e.count ?? 0), 0);
  const activeUsers = data?.admin?.totalActiveUsers ?? 0;
  const leadsThisWeek = data?.kpis?.leadsPeriod ?? data?.kpis?.leadsThisWeek ?? 0;
  const avgConvRate =
    convList.length > 0
      ? (
          convList.reduce(
            (s: number, e: any) => s + Number(e.rate ?? 0),
            0
          ) / convList.length
        ).toFixed(1)
      : "0.0";

  // ── Lead source breakdown ────────────────────────────────────
  const sourceBreakdown: { type: string; count: number }[] =
    data?.kpis?.leadSourceBreakdown ?? [];
  const maxSource = Math.max(...sourceBreakdown.map((s) => s.count), 1);

  // ── Leads over time ──────────────────────────────────────────
  const leadsOverTime: { month: string; count: number }[] = Array.isArray(
    data?.leadsOverTime
  )
    ? data.leadsOverTime
    : [];

  // ── Team overview ────────────────────────────────────────────
  const teamUsers: any[] = Array.isArray(teamList) ? teamList : [];
  const managerCount = teamUsers.filter((u) => u.role === "manager").length;
  const execCount = teamUsers.filter((u) => u.role === "sales_user").length;

  // ── Filter dropdowns ─────────────────────────────────────────
  const managers = teamUsers.filter((u) => u.role === "manager");
  const executives = selectedManagerId
    ? teamUsers.filter(
        (u) => u.role === "sales_user" && u.managerId === selectedManagerId
      )
    : [];

  // ── Team panel: scope to selection ───────────────────────────
  const displayedTeamUsers = selectedExecId
    ? teamUsers.filter((u) => u.id === selectedExecId)
    : selectedManagerId
    ? teamUsers.filter(
        (u) => u.id === selectedManagerId || u.managerId === selectedManagerId
      )
    : teamUsers;

  // ── Recent activity ──────────────────────────────────────────
  const auditLogs: any[] = Array.isArray(data?.admin?.recentAuditLogs)
    ? data.admin.recentAuditLogs
    : [];

  // ── KPI trends (dynamic) ────────────────────────────────────
  const leadsLastMonth: number = data?.kpis?.leadsLastMonth ?? 0;
  const totalLeadsNum = typeof totalLeads === "number" ? totalLeads : 0;
  const monthGrowth =
    leadsLastMonth > 0
      ? (((totalLeadsNum - leadsLastMonth) / leadsLastMonth) * 100).toFixed(1)
      : null;

  const periodLabel =
    selectedPeriod === "today" ? "Leads today" : selectedPeriod === "week" ? "Leads this week" : selectedPeriod === "quarter" ? "Leads this quarter" : "Leads this month";
  const periodHint =
    selectedPeriod === "today" ? "Since midnight" : selectedPeriod === "week" ? "Since Monday" : selectedPeriod === "quarter" ? "Current quarter" : "Since 1st";

  return (
    <div className="space-y-6">
      {/* Header */}
      <DashboardHeader title="Admin Dashboard" subtitle="View All Teams">
        {/* Period filter */}
        <FilterSelect icon={CalendarRange} tone="blue"
          title="Filter by time period"
          value={selectedPeriod}
          onChange={(e) => setSelectedPeriod(e.target.value)}
        >
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="quarter">This quarter</option>
        </FilterSelect>

        {/* Manager dropdown */}
        <FilterSelect icon={Briefcase} tone="violet"
          title="Filter by sales manager"
          value={selectedManagerId}
          onChange={(e) => {
            setSelectedManagerId(e.target.value);
            setSelectedExecId("");
          }}
        >
          <option value="">All sales managers</option>
          {managers.map((m: any) => (
            <option key={m.id} value={m.id}>
              {m.name || m.email}
            </option>
          ))}
        </FilterSelect>

        {/* Executive dropdown — disabled until manager is selected */}
        <FilterSelect icon={UserCheck} tone="emerald"
          title={selectedManagerId ? "Filter by executive" : "Select a manager first"}
          value={selectedExecId}
          onChange={(e) => setSelectedExecId(e.target.value)}
          disabled={!selectedManagerId}
        >
          <option value="">
            {selectedManagerId ? "All executives" : "Select manager first"}
          </option>
          {executives.map((e: any) => (
            <option key={e.id} value={e.id}>
              {e.name || e.email}
            </option>
          ))}
        </FilterSelect>
      </DashboardHeader>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Users} tone="blue" label="Total leads" value={totalLeads.toLocaleString()}>
          {monthGrowth !== null ? (
            <span className={`inline-flex items-center gap-1 font-medium ${Number(monthGrowth) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
              {Number(monthGrowth) >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
              {Number(monthGrowth) >= 0 ? "+" : ""}{monthGrowth}%
              <span className="font-normal text-ink-3">vs last month</span>
            </span>
          ) : (
            "All time total"
          )}
        </KpiCard>
        <KpiCard icon={UserCheck} tone="indigo" label="Active users" value={activeUsers}>
          {managerCount} sales mgrs · {execCount} execs
        </KpiCard>
        <KpiCard icon={CalendarRange} tone="violet" label={periodLabel} value={leadsThisWeek}>
          {periodHint}
        </KpiCard>
        <KpiCard icon={Percent} tone="emerald" label="Conversion rate" value={`${avgConvRate}%`}>
          {convList.length} exec{convList.length !== 1 ? "s" : ""} tracked
        </KpiCard>
      </div>

      {/* Middle Row: Lead source breakdown + Leads over time */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Lead source breakdown" icon={PieChart} tone="violet">
          {sourceBreakdown.length === 0 ? (
            <EmptyBlock icon={PieChart} message="No data" />
          ) : (
            <div className="overflow-y-auto max-h-[200px] pr-1 space-y-5">
              {sourceBreakdown.map((s) => (
                <BarRow
                  key={s.type}
                  label={LEAD_TYPE_LABELS[s.type] ?? s.type}
                  count={s.count.toLocaleString()}
                  pct={(s.count / maxSource) * 100}
                  tone={LEAD_TYPE_COLORS[s.type] ?? "blue"}
                />
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Leads over time" icon={BarChart3} tone="blue">
          {leadsOverTime.length === 0 ? (
            <EmptyBlock icon={BarChart3} message="No data" />
          ) : (
            <div className="mt-auto">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={leadsOverTime}
                  margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="adminLeadsBar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ct.series[1]} />
                      <stop offset="100%" stopColor={ct.series[0]} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke={ct.grid} />
                  <XAxis dataKey="month" tick={ct.tick} axisLine={false} tickLine={false} />
                  <YAxis tick={ct.tick} axisLine={false} tickLine={false} />
                  <Tooltip cursor={ct.cursor} content={<ChartTooltip />} />
                  <Bar dataKey="count" fill="url(#adminLeadsBar)" radius={[6, 6, 0, 0]} maxBarSize={36} animationDuration={500} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Lower Row: Team overview + Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Team overview" icon={Users} tone="emerald">
          {displayedTeamUsers.length === 0 ? (
            <EmptyBlock icon={Users} message="No team data" />
          ) : (
            <div className="overflow-y-auto max-h-[220px] -mx-2 pr-1">
              {displayedTeamUsers.map((user: any) => (
                <div key={user.id} className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-gradient-to-r hover:from-emerald-50 hover:to-transparent dark:hover:from-emerald-500/[0.08] transition-colors duration-150">
                  <PersonAvatar name={user.name || user.email || "U"} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-ink truncate">
                      {user.name || user.email}
                    </p>
                    <p className="text-xs text-ink-3">
                      {ROLE_LABELS[user.role] ?? user.role}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                      user.isActive
                        ? "px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20"
                        : "px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-1 ring-rose-500/20"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${user.isActive ? "bg-emerald-500" : "bg-rose-500"}`} />
                    {user.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Recent system activity" icon={Activity} tone="amber">
          {auditLogs.length === 0 ? (
            <EmptyBlock icon={Activity} message="No recent activity" />
          ) : (
            <div className="overflow-y-auto max-h-[220px] pr-1">
              <ol className="relative">
                {auditLogs.map((log: any, i: number) => (
                  <li key={log.id || i} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < auditLogs.length - 1 && (
                      <span className="absolute left-[3.5px] top-3 bottom-0 w-px bg-slate-200 dark:bg-slate-400/[0.15]" />
                    )}
                    <span className={`relative mt-1.5 w-2 h-2 rounded-full ring-4 flex-shrink-0 ${activityDotClass(log.action)}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-ink-2 leading-snug">
                        <span className="font-medium text-ink">
                          {log.changedBy?.name ?? "System"}
                        </span>{" "}
                        {(log.action ?? "")
                          .toLowerCase()
                          .replace(/_/g, " ")}{" "}
                        {(log.entityType ?? "").toLowerCase()}
                      </p>
                      <p className="text-[11px] text-ink-3 mt-0.5">
                        {timeAgo(log.changedAt ?? log.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
