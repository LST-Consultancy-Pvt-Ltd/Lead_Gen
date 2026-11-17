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
  EmptyBlock,
  FilterSelect,
  MultiFilterSelect,
} from "./DashboardUI";
import { useDashboardSSE } from "../../hooks/useDashboardRefresh";
import { useUserRole } from "../../lib/rbac";
import {
  TrendingUp,
  TrendingDown,
  Users,
  UserCheck,
  CalendarRange,
  PieChart,
  Activity,
  Briefcase,
  AlertTriangle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FollowUpCalendar } from "./FollowUpCalendar";

// ── Helpers ────────────────────────────────────────────────────────────────

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

  const [selectedManagerIds, setSelectedManagerIds] = useState<string[]>([]);
  const [selectedExecIds, setSelectedExecIds] = useState<string[]>([]);
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
    queryKey: ["dashboard", "ceo", selectedManagerIds, selectedExecIds, selectedPeriod],
    queryFn: () => {
      const { dateFrom, dateTo } = getPeriodRange(selectedPeriod);
      const params: Record<string, string> = { dateFrom, dateTo, period: selectedPeriod };
      if (selectedManagerIds.length) params.managerId = selectedManagerIds.join(",");
      if (selectedExecIds.length) params.executiveId = selectedExecIds.join(",");
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
    return <DashboardSkeleton kpis={3} />;
  }

  // ── KPI derivations ──────────────────────────────────────────
  const execList = Array.isArray(data?.leadsByExecutive)
    ? data.leadsByExecutive
    : [];
  const totalLeads =
    data?.kpis?.totalLeads ??
    execList.reduce((s: number, e: any) => s + (e.count ?? 0), 0);
  const leadsThisWeek = data?.kpis?.leadsPeriod ?? data?.kpis?.leadsThisWeek ?? 0;

  // ── Lead source breakdown ────────────────────────────────────
  const sourceBreakdown: { type: string; count: number }[] = [
    ...(data?.kpis?.leadSourceBreakdown ?? []),
  ].sort((a, b) => b.count - a.count);
  const maxSource = Math.max(...sourceBreakdown.map((s) => s.count), 1);

  // ── Team list (drives the filters and the calendar) ──────────
  const teamUsers: any[] = Array.isArray(teamList) ? teamList : [];

  // ── Follow-ups ───────────────────────────────────────────────
  const overdueFollowUps: any[] = (() => {
    const raw = data?.overdueFollowUps;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter((f: any) => f.entityType !== 'opportunity');
    return raw.leads ?? [];
  })();

  // Calendar owner filter — everyone the admin can see
  const calendarAssignees = teamUsers
    .filter((u) => u.role === "sales_user" || u.role === "manager")
    .map((u) => ({ id: u.id, name: u.name || u.email }));

  // ── Filter dropdowns ─────────────────────────────────────────
  const managers = teamUsers.filter((u) => u.role === "manager");
  const executives = selectedManagerIds.length
    ? teamUsers.filter(
        (u) => u.role === "sales_user" && selectedManagerIds.includes(u.managerId)
      )
    : [];

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

        {/* Manager filter */}
        <MultiFilterSelect icon={Briefcase} tone="violet"
          title="Filter by sales manager"
          placeholder="All sales managers" noun="managers"
          value={selectedManagerIds}
          onChange={(v) => {
            setSelectedManagerIds(v);
            // Execs are scoped to the chosen managers — drop any that no
            // longer belong to one, or the API answers 403.
            setSelectedExecIds((prev) =>
              prev.filter((id) =>
                teamUsers.some((u: any) => u.id === id && v.includes(u.managerId))
              )
            );
          }}
          options={managers.map((m: any) => ({ value: m.id, label: m.name || m.email }))}
        />

        {/* Executive filter — disabled until a manager is picked */}
        <MultiFilterSelect icon={UserCheck} tone="emerald"
          title={selectedManagerIds.length ? "Filter by executive" : "Select a manager first"}
          placeholder={selectedManagerIds.length ? "All executives" : "Select manager first"}
          noun="executives"
          value={selectedExecIds}
          onChange={setSelectedExecIds}
          disabled={!selectedManagerIds.length}
          options={executives.map((e: any) => ({ value: e.id, label: e.name || e.email }))}
        />
      </DashboardHeader>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard icon={Users} tone="blue" label="Total leads" value={totalLeads.toLocaleString()} href="/dashboard/leads">
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
        <KpiCard icon={CalendarRange} tone="violet" label={periodLabel} value={leadsThisWeek} href="/dashboard/leads">
          {periodHint}
        </KpiCard>
        <KpiCard
          icon={AlertTriangle}
          tone={overdueFollowUps.length > 0 ? "rose" : "emerald"}
          label="Overdue follow-ups"
          value={overdueFollowUps.length}
          href="/dashboard/leads?followUp=overdue"
        >
          {overdueFollowUps.length > 0 ? "Org-wide, across all teams" : "All teams caught up"}
        </KpiCard>
      </div>

      {/* Follow-up calendar */}
      <FollowUpCalendar
        scopeLabel="All teams"
        assignees={calendarAssignees}
        showOwnerBreakdown
        ownerBreakdownTitle="Overdue by owner"
      />

      {/* Lead source breakdown + Recent activity, side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Lead source breakdown" subtitle="All leads" icon={PieChart} tone="violet">
          {sourceBreakdown.length === 0 ? (
            <EmptyBlock icon={PieChart} message="No data" />
          ) : (
            <div className="overflow-y-auto max-h-[360px] pr-1 space-y-4">
              {sourceBreakdown.map((s) => (
                <BarRow
                  key={s.type}
                  label={LEAD_TYPE_LABELS[s.type] ?? s.type}
                  count={s.count.toLocaleString()}
                  pct={(s.count / maxSource) * 100}
                  tone={LEAD_TYPE_COLORS[s.type] ?? "blue"}
                  href={`/dashboard/leads?source=${encodeURIComponent(s.type)}`}
                />
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Recent system activity" icon={Activity} tone="amber">
          {auditLogs.length === 0 ? (
            <EmptyBlock icon={Activity} message="No recent activity" />
          ) : (
            <div className="overflow-y-auto max-h-[360px] pr-1">
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
