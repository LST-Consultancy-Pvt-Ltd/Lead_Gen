import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

/**
 * Dashboard query key prefixes — all dashboard queries start with 'dashboard'.
 * Invalidating ['dashboard'] will refetch every role's dashboard automatically.
 */
const DASHBOARD_QUERY_PREFIX = ['dashboard'];

/**
 * Hook that returns a function to invalidate all dashboard queries.
 * Call this after any mutation that would affect dashboard data:
 * leads CRUD, opportunities CRUD, activities CRUD, imports, etc.
 */
export function useDashboardRefresh() {
  const queryClient = useQueryClient();

  const refreshDashboard = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_PREFIX });
  }, [queryClient]);

  return refreshDashboard;
}

/**
 * Standalone function for use outside React components (e.g., in onSuccess callbacks).
 * Requires the queryClient to be passed in.
 */
export function invalidateDashboardQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_PREFIX });
}

/**
 * SSE-based real-time dashboard refresh.
 * Opens an EventSource to the backend's SSE endpoint and invalidates
 * the relevant dashboard query key whenever the server pushes an event.
 *
 * Reconnects automatically (with exponential back-off up to 30 s)
 * and cleans up on unmount.
 *
 * @param role - The current user's role (used to scope the SSE channel).
 *               If undefined/null the hook is a no-op.
 */
export function useDashboardSSE(role: string | undefined | null) {
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);
  const retryDelay = useRef(1_000);

  useEffect(() => {
    if (!accessToken || !role) return;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    function connect() {
      if (unmounted) return;

      // Build the SSE URL with token & role as query params
      const url = `${API_URL}/analytics/dashboard/stream?token=${encodeURIComponent(accessToken)}&role=${encodeURIComponent(role!)}`;
      es = new EventSource(url);

      es.onopen = () => {
        // Reset retry delay on successful connection
        retryDelay.current = 1_000;
      };

      // Default `message` event → invalidate all dashboard queries
      es.onmessage = () => {
        queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_PREFIX });
      };

      // Named event support: the backend can send specific event types
      es.addEventListener('dashboard_update', () => {
        queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_PREFIX });
      });

      es.onerror = () => {
        // Close the broken connection & schedule reconnect with back-off
        es?.close();
        es = null;
        if (!unmounted) {
          retryTimer = setTimeout(() => {
            retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
            connect();
          }, retryDelay.current);
        }
      };
    }

    connect();

    return () => {
      unmounted = true;
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [accessToken, role, queryClient]);
}
