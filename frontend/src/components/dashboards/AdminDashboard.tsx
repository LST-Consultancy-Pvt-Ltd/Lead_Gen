"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { analyticsApi, usersApi } from "../../lib/api";
import { Spinner } from "../../components/ui";
import { useDashboardSSE } from "../../hooks/useDashboardRefresh";
import { useUserRole } from "../../lib/rbac";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Users,
  UserPlus,
  Download,
  Settings,
} from "lucide-react";
import { useRouter } from "next/navigation";

// ── Helpers ────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-red-500",
  "bg-cyan-500",
  "bg-pink-500",
];

function getAvatarColor(name: string) {
  const hash = (name || "")
    .split("")
    .reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function Avatar({ name }: { name: string }) {
  const initials = (name || "U")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${getAvatarColor(name)}`}
    >
      {initials}
    </div>
  );
}

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

const LEAD_TYPE_COLORS: Record<string, string> = {
  position_discovery: "bg-blue-500",
  product_discovery: "bg-emerald-500",
  manual: "bg-amber-500",
};

const ACTIVITY_DOT_COLORS = [
  "bg-blue-400",
  "bg-emerald-400",
  "bg-amber-400",
  "bg-orange-400",
  "bg-violet-400",
  "bg-red-400",
];

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
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={24} />
      </div>
    );
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="page-title">Admin Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            View All Teams
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period filter */}
          <select
            title="Filter by time period"
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className="text-xs bg-slate-800 border border-white/10 text-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer"
          >
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="quarter">This quarter</option>
          </select>

          {/* Manager dropdown */}
          <select
            title="Filter by sales manager"
            value={selectedManagerId}
            onChange={(e) => {
              setSelectedManagerId(e.target.value);
              setSelectedExecId("");
            }}
            className="text-xs bg-slate-800 border border-white/10 text-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer"
          >
            <option value="">All sales managers</option>
            {managers.map((m: any) => (
              <option key={m.id} value={m.id}>
                {m.name || m.email}
              </option>
            ))}
          </select>

          {/* Executive dropdown — disabled until manager is selected */}
          <select
            title={selectedManagerId ? "Filter by executive" : "Select a manager first"}
            value={selectedExecId}
            onChange={(e) => setSelectedExecId(e.target.value)}
            disabled={!selectedManagerId}
            className={`text-xs bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500 transition-opacity ${
              selectedManagerId
                ? "text-slate-300 cursor-pointer opacity-100"
                : "text-slate-500 cursor-not-allowed opacity-50"
            }`}
          >
            <option value="">
              {selectedManagerId ? "All executives" : "Select manager first"}
            </option>
            {executives.map((e: any) => (
              <option key={e.id} value={e.id}>
                {e.name || e.email}
              </option>
            ))}
          </select>

          {/* <span className="text-xs bg-violet-500/10 border border-violet-500/20 text-violet-400 px-3 py-1 rounded-full font-medium">
            Admin
          </span> */}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5">
          <p className="text-xs text-slate-500 mb-1">Total leads</p>
          <p className="text-2xl font-bold text-slate-100">
            {totalLeads.toLocaleString()}
          </p>
          {monthGrowth !== null ? (
            <p className={`text-xs mt-1 flex items-center gap-1 ${Number(monthGrowth) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {Number(monthGrowth) >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
              {Number(monthGrowth) >= 0 ? "+" : ""}{monthGrowth}% vs last month
            </p>
          ) : (
            <p className="text-xs text-slate-500 mt-1">All time total</p>
          )}
        </div>
        <div className="card p-5">
          <p className="text-xs text-slate-500 mb-1">Active users</p>
          <p className="text-2xl font-bold text-slate-100">{activeUsers}</p>
          <p className="text-xs text-slate-500 mt-1">
            {managerCount} sales mgrs · {execCount} execs
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-slate-500 mb-1">
            {selectedPeriod === "today" ? "Leads today" : selectedPeriod === "week" ? "Leads this week" : selectedPeriod === "quarter" ? "Leads this quarter" : "Leads this month"}
          </p>
          <p className="text-2xl font-bold text-slate-100">{leadsThisWeek}</p>
          <p className="text-xs text-slate-500 mt-1">
            {selectedPeriod === "today" ? "Since midnight" : selectedPeriod === "week" ? "Since Monday" : selectedPeriod === "quarter" ? "Current quarter" : "Since 1st"}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-slate-500 mb-1">Conversion rate</p>
          <p className="text-2xl font-bold text-slate-100">{avgConvRate}%</p>
          <p className="text-xs text-slate-500 mt-1">
            {convList.length} exec{convList.length !== 1 ? "s" : ""} tracked
          </p>
        </div>
      </div>

      {/* Middle Row: Lead source breakdown + Leads over time */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lead source breakdown */}
        <div className="card p-5">
          <h2 className="section-title mb-5">Lead source breakdown</h2>
          {sourceBreakdown.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">No data</p>
          ) : (
            <div className="overflow-y-auto max-h-[200px] pr-1 space-y-5 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
              {sourceBreakdown.map((s) => (
                <div key={s.type}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-slate-300">
                      {LEAD_TYPE_LABELS[s.type] ?? s.type}
                    </span>
                    <span className="text-slate-400 font-semibold">
                      {s.count.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ease-out ${LEAD_TYPE_COLORS[s.type] ?? "bg-blue-500"}`}
                      style={{ width: `${(s.count / maxSource) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Leads over time */}
        <div className="card p-5 flex flex-col">
          <h2 className="section-title mb-4">Leads over time</h2>
          {leadsOverTime.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-10">No data</p>
          ) : (
            <div className="mt-auto">
            <ResponsiveContainer width="100%" height={160}>
              <BarChart
                data={leadsOverTime}
                margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
              >
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={({ active, payload, label }: any) =>
                    active && payload?.length ? (
                      <div className="bg-slate-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs shadow-xl">
                        <span className="text-slate-400">{label}: </span>
                        <span className="text-blue-400 font-semibold">
                          {payload[0].value}
                        </span>
                      </div>
                    ) : null
                  }
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Lower Row: Team overview + Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Team overview */}
        <div className="card p-5">
          <h2 className="section-title mb-4">Team overview</h2>
          {displayedTeamUsers.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">
              No team data
            </p>
          ) : (
            <div className="overflow-y-auto max-h-[200px] pr-1 space-y-3 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
              {displayedTeamUsers.map((user: any) => (
                <div key={user.id} className="flex items-center gap-3">
                  <Avatar name={user.name || user.email || "U"} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">
                      {user.name || user.email}
                    </p>
                    <p className="text-xs text-slate-500">
                      {ROLE_LABELS[user.role] ?? user.role}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                      user.isActive
                        ? "bg-green-500/15 text-green-400 border-green-500/25"
                        : "bg-slate-500/15 text-slate-400 border-slate-500/25"
                    }`}
                  >
                    {user.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent system activity */}
        <div className="card p-5">
          <h2 className="section-title mb-4">Recent system activity</h2>
          {auditLogs.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">
              No recent activity
            </p>
          ) : (
            <div className="overflow-y-auto max-h-[200px] pr-1 space-y-4 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
              {auditLogs.map((log: any, i: number) => (
                <div key={log.id || i} className="flex items-start gap-3">
                  <div
                    className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${ACTIVITY_DOT_COLORS[i % ACTIVITY_DOT_COLORS.length]}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-300 leading-relaxed">
                      <span className="font-medium">
                        {log.changedBy?.name ?? "System"}
                      </span>{" "}
                      {(log.action ?? "")
                        .toLowerCase()
                        .replace(/_/g, " ")}{" "}
                      {(log.entityType ?? "").toLowerCase()}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {timeAgo(log.changedAt ?? log.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Actions Bar */}
      {/* <div className="card p-4">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => router.push("/dashboard/team")}
            className="btn-ghost text-sm"
          >
            <UserPlus size={14} /> Add user
          </button>
          <button
            onClick={() => router.push("/dashboard/settings?tab=roles")}
            className="btn-ghost text-sm"
          >
            <Users size={14} /> Manage roles
          </button>
          <button
            onClick={() => router.push("/dashboard/leads?export=1")}
            className="btn-ghost text-sm"
          >
            <Download size={14} /> Export data
          </button>
          <button
            onClick={() => router.push("/dashboard/settings")}
            className="btn-ghost text-sm"
          >
            <Settings size={14} /> System settings
          </button>
        </div>
      </div> */}
    </div>
  );
}
