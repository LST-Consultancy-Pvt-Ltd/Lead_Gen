"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { analyticsApi } from "../../lib/api";
import { Spinner } from "../../components/ui";
import {
  WidgetGrid,
  DateFilterBar,
  type DashboardWidget,
} from "./DashboardWidgets";
import { buildManagerWidgets, getDateRange } from "./ManagerDashboard";
import { HeartPulse } from "lucide-react";
import { useDashboardSSE } from "../../hooks/useDashboardRefresh";
import { useUserRole } from "../../lib/rbac";

/**
 * Normalizes CEO/Admin API response → DashboardWidget[].
 * Inherits all 8 manager widgets + admin-only extras.
 * If backend sends `widgets[]`, uses that directly.
 */
function buildAdminWidgets(data: any): DashboardWidget[] {
  // Backend-driven mode: if API already sends widgets[], return directly
  if (Array.isArray(data?.widgets)) {
    return data.widgets as DashboardWidget[];
  }

  // Reuse all manager widgets (system-wide scope provided by backend)
  const managerWidgets = buildManagerWidgets(data);

  // Prepend admin-only extras
  const adminExtras: DashboardWidget[] = [];

  adminExtras.push({
    id: "total_active_users",
    type: "stat_card",
    title: "Total active users",
    icon: "users",
    color: "blue",
    layout: "half",
    data: {
      value: data?.totalActiveUsers ?? data?.activeUsers ?? 0,
      tag: "Users",
    },
  });

  const recentAuditLogs = Array.isArray(
    data?.recentAuditLogs ?? data?.auditLogs,
  )
    ? (data?.recentAuditLogs ?? data?.auditLogs)
    : [];
  if (recentAuditLogs.length > 0) {
    adminExtras.push({
      id: "recent_audit_logs",
      type: "table",
      title: "Recent Audit Log",
      icon: "alert",
      color: "amber",
      layout: "half",
      data: {
        items: recentAuditLogs.slice(0, 10),
        columns: [
          { key: "action", label: "Action", color: "primary" },
          { key: "userName", label: "User" },
          { key: "createdAt", label: "Date" },
        ],
      },
    });
  }

  return [...adminExtras, ...managerWidgets];
}

export function AdminDashboard() {
  const role = useUserRole();
  useDashboardSSE(role);

  const [datePreset, setDatePreset] = useState("last_30");
  const params = getDateRange(datePreset);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "ceo", datePreset],
    queryFn: () =>
      analyticsApi
        .getCEODashboard(params)
        .then((r) => r.data?.data ?? r.data ?? {}),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  const widgets = useMemo(() => buildAdminWidgets(data ?? {}), [data]);

  const systemHealth = data?.systemHealth ?? null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={24} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="page-title">Admin Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Organization-wide performance — all teams, all data
          </p>
        </div>
        <span className="text-xs bg-violet-500/10 border border-violet-500/20 text-violet-400 px-3 py-1 rounded-full font-medium">
          Full system access
        </span>
      </div>

      {/* System Health (if backend provides it) */}
      {systemHealth && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              System Health
            </span>
            <HeartPulse size={14} className="text-emerald-400" />
          </div>
          <div className="flex flex-wrap gap-4">
            {Object.entries(systemHealth).map(([key, val]: [string, any]) => (
              <div key={key} className="flex items-center gap-2 text-xs">
                <div
                  className={`w-2 h-2 rounded-full ${val === "healthy" || val === "ok" || val === true ? "bg-emerald-400" : "bg-amber-400"}`}
                />
                <span className="text-slate-400 capitalize">
                  {key.replace(/([A-Z])/g, " $1").trim()}
                </span>
                <span
                  className={`font-semibold ${val === "healthy" || val === "ok" || val === true ? "text-emerald-400" : "text-amber-400"}`}
                >
                  {typeof val === "boolean"
                    ? val
                      ? "OK"
                      : "Issue"
                    : String(val)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <DateFilterBar value={datePreset} onChange={setDatePreset} />
      <WidgetGrid widgets={widgets} />
    </div>
  );
}
