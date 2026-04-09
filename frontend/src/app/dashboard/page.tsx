'use client';

import { usePermissions } from '../../lib/rbac';
import { AdminDashboard } from '../../components/dashboards/AdminDashboard';
import { ManagerDashboard } from '../../components/dashboards/ManagerDashboard';
import { ExecutiveDashboard } from '../../components/dashboards/ExecutiveDashboard';

export default function DashboardPage() {
  const permissions = usePermissions();

  if (permissions.isAdmin) {
    return <AdminDashboard />;
  }

  if (permissions.isManager) {
    return <ManagerDashboard />;
  }

  return <ExecutiveDashboard />;
}
