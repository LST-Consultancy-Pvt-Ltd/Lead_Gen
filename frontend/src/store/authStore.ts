import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl?: string;
  organization: { id: string; name: string; slug: string };
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  clearAuth: () => void;
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
}

// ── Permissions Hook ────────────────────────────────────────────────────────
export function usePermissions() {
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.role === 'org_admin';
  const isManager = user?.role === 'manager';
  const isSalesUser = user?.role === 'sales_user';
  return {
    isAdmin,
    isManager,
    isSalesUser,
    canViewAll: isAdmin,
    canViewTeam: isAdmin || isManager,
    canReassign: isAdmin || isManager,
    canInviteManagers: isAdmin,
    canInviteSalesUsers: isAdmin || isManager,
    canDeleteLeads: isAdmin,
    canImport: isAdmin || isManager,
    canManageUsers: isAdmin,
    canViewCEODashboard: isAdmin,
    canViewManagerDashboard: isAdmin || isManager,
  };
}

export function getRoleLabel(role?: string | null): string {
  switch (role) {
    case 'org_admin': return 'Organization Admin';
    case 'super_admin': return 'Super Admin';
    case 'manager': return 'Sales Manager';
    case 'sales_user': return 'Sales Executive';
    default: return role ?? '';
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      _hasHydrated: false,
      setAuth: (user, accessToken, refreshToken) => {
        // Store tokens in localStorage for API interceptor
        localStorage.setItem('accessToken', accessToken);
        localStorage.setItem('refreshToken', refreshToken);
        set({ user, accessToken, refreshToken, isAuthenticated: true });
      },
      clearAuth: () => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
      },
      setHasHydrated: (state) => {
        set({ _hasHydrated: state });
      },
    }),
    {
      name: 'leadforge-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        // When store is rehydrated, sync tokens to localStorage
        if (state?.accessToken && state?.refreshToken) {
          localStorage.setItem('accessToken', state.accessToken);
          localStorage.setItem('refreshToken', state.refreshToken);
        }
        state?.setHasHydrated(true);
      },
    }
  )
);
