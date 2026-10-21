
// const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

// export const api = axios.create({
//   baseURL: API_URL,
//   timeout: 30000,
//   headers: { 'Content-Type': 'application/json' },
// });

// // Attach JWT
// api.interceptors.request.use((config) => {
//   if (typeof window !== 'undefined') {
//     const token = localStorage.getItem('accessToken');
//     if (token) config.headers.Authorization = `Bearer ${token}`;
//   }
//   return config;
// });

// // Auto-refresh on 401
// api.interceptors.response.use(
//   (r) => r,
//   async (error: AxiosError) => {
//     const original = error.config as any;
//     if (error.response?.status === 401 && !original._retry) {
//       original._retry = true;
//       try {
//         const refresh = localStorage.getItem('refreshToken');
//         const { data } = await axios.post(`${API_URL}/auth/refresh`, { refreshToken: refresh });
//         localStorage.setItem('accessToken', data.data.accessToken);
//         localStorage.setItem('refreshToken', data.data.refreshToken);
//         original.headers.Authorization = `Bearer ${data.data.accessToken}`;
//         return api(original);
//       } catch {
//         localStorage.clear();
//         window.location.href = '/auth/login';
//       }
//     }
//     return Promise.reject(error);
//   }
// );

// // ── API helpers ───────────────────────────────────────────────────────────
// export const authApi = {
//   register: (data: any) => api.post('/auth/register', data),
//   login: (data: any) => api.post('/auth/login', data),
//   googleAuth: (credential: string) => api.post('/auth/google', { credential }),
//   refresh: (refreshToken: string) => api.post('/auth/refresh', { refreshToken }),
//   logout: () => api.post('/auth/logout'),
//   me: () => api.get('/auth/me'),
// };

// export const leadsApi = {
//   list: (params?: any) => api.get('/leads', { params }),
//   get: (id: string) => api.get(`/leads/${id}`),
//   create: (data: any) => api.post('/leads', data),
//   update: (id: string, data: any) => api.patch(`/leads/${id}`, data),
//   delete: (id: string) => api.delete(`/leads/${id}`),
//   analyze: (id: string) => api.post(`/leads/${id}/analyze`),
//   enrich: (id: string) => api.post(`/leads/${id}/enrich`),
//   generateEmail: (id: string) => api.post(`/leads/${id}/generate-email`),
//   sendOutreach: (id: string, data: any) => api.post(`/leads/${id}/send-outreach`, data),
//   export: () => api.get('/leads/export', { responseType: 'blob' }),
// };

// export const discoveryApi = {
//   startScan: (data?: any) => api.post('/discovery/scan', data || {}),
//   startProductScan: (data?: any) => api.post('/discovery/scan/product', data || {}),
//   getActiveScan: () => api.get('/discovery/scan/active'),
//   getScanStatus: (jobId: string) => api.get(`/discovery/scan/${jobId}`),
//   getScans: () => api.get('/discovery/scans'),
//   getSignals: (params?: any) => api.get('/discovery/signals', { params }),
//   getServices: () => api.get('/discovery/services'),
//   updateServices: (services: any[]) => api.put('/discovery/services', { services }),
// };

// export const campaignsApi = {
//   list: () => api.get('/campaigns'),
//   get: (id: string) => api.get(`/campaigns/${id}`),
//   create: (data: any) => api.post('/campaigns', data),
//   update: (id: string, data: any) => api.patch(`/campaigns/${id}`, data),
//   addLeads: (id: string, leadIds: string[]) => api.post(`/campaigns/${id}/leads`, { leadIds }),
//   launch: (id: string) => api.post(`/campaigns/${id}/launch`),
// };

// export const analyticsApi = {
//   overview: () => api.get('/analytics/overview'),
//   monthly: () => api.get('/analytics/leads/monthly'),
//   byStatus: () => api.get('/analytics/leads/status'),
//   topSources: () => api.get('/analytics/leads/sources'),
// };

// export const teamApi = {
//   list: () => api.get('/team'),
//   invite: (data: any) => api.post('/team', data),
//   update: (id: string, data: any) => api.patch(`/team/${id}`, data),
//   remove: (id: string) => api.delete(`/team/${id}`),
// };


import axios, { AxiosError } from 'axios';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store/authStore';
import { createTokenRefresher, isSessionEndedError } from './tokenRefresh';
import { SESSION_EXPIRED_EVENT } from './formDraft';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT (skip for login/register endpoints)
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    // Don't attach token to login/register requests
    const isAuthEndpoint = config.url?.includes('/auth/login') || 
                          config.url?.includes('/auth/register') ||
                          config.url?.includes('/auth/refresh');
    
    if (!isAuthEndpoint) {
      const token = localStorage.getItem('accessToken');
      if (token) config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Auto-refresh on 401 & Global 403 handling.
// One refresh at a time per tab (and across tabs); every request that hits a 401
// while it runs waits for the same new token, then is retried once.
const refreshAccessToken = createTokenRefresher({
  store: {
    getAccessToken: () => localStorage.getItem('accessToken'),
    getRefreshToken: () => localStorage.getItem('refreshToken'),
    setTokens: (accessToken, refreshToken) => useAuthStore.getState().setTokens(accessToken, refreshToken),
  },
  // Plain axios (not `api`) so the refresh call never re-enters this interceptor
  request: async (refreshToken) => {
    const { data } = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
    return {
      accessToken: data.data?.accessToken || data.accessToken,
      refreshToken: data.data?.refreshToken || data.refreshToken,
    };
  },
});

let sessionEnding = false;

// The refresh token is expired / revoked / the user is inactive. Let open forms save
// their drafts first, then drop only the auth state (drafts and preferences stay)
// and send the user to login, returning to the current page afterwards.
function endSession() {
  if (sessionEnding || typeof window === 'undefined') return;
  sessionEnding = true;
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  useAuthStore.getState().clearAuth();
  toast.error('Your session has expired. Please log in again.');
  const returnTo = window.location.pathname + window.location.search;
  setTimeout(() => {
    window.location.href = `/auth/login?redirect=${encodeURIComponent(returnTo)}`;
  }, 1000);
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as any;

    // Don't attempt token refresh for auth endpoints — a 401 here means
    // wrong credentials / expired refresh token, not an expired access token.
    const isAuthEndpoint = original?.url?.includes('/auth/login') ||
                          original?.url?.includes('/auth/register') ||
                          original?.url?.includes('/auth/refresh');

    // Handle 401 - Unauthorized (Token expired)
    if (error.response?.status === 401 && original && !original._retry && !isAuthEndpoint) {
      const sentHeader = original.headers?.Authorization ?? original.headers?.get?.('Authorization');
      const failedToken = typeof sentHeader === 'string' ? sentHeader.replace(/^Bearer /, '') : null;

      // Anonymous request (no session to refresh) — surface the original error
      if (!failedToken && !localStorage.getItem('refreshToken')) {
        return Promise.reject(error);
      }

      original._retry = true;
      try {
        const newAccessToken = await refreshAccessToken(failedToken);
        original.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(original);
      } catch (refreshError: any) {
        // Never log the error object itself — its request config contains the refresh token
        console.warn('Token refresh failed:', refreshError?.response?.status ?? refreshError?.message);

        // Only end the session if the refresh token is actually invalid
        // (network / server errors leave the user signed in)
        if (isSessionEndedError(refreshError)) endSession();

        return Promise.reject(refreshError);
      }
    }
    
    // Handle 403 - Forbidden (Permission denied)
    if (error.response?.status === 403) {
      const message = (error.response.data as any)?.message || 'You do not have permission to perform this action';
      if (typeof window !== 'undefined') {
        toast.error(message);
      }
    }
    
    return Promise.reject(error);
  }
);

// ── API helpers ───────────────────────────────────────────────────────────
export const authApi = {
  register: (data: any) => api.post('/auth/register', data),
  login: (data: any) => api.post('/auth/login', data),
  googleAuth: (credential: string) => api.post('/auth/google', { credential }),
  refresh: (refreshToken: string) => api.post('/auth/refresh', { refreshToken }),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  verifyOtp: (data: { email: string; otp: string }) => api.post('/auth/verify-otp', data),
  resendOtp: (data: { email: string }) => api.post('/auth/resend-otp', data),
  forgotPassword: (data: { email: string }) => api.post('/auth/forgot-password', data),
  verifyResetOtp: (data: { email: string; otp: string }) => api.post('/auth/verify-reset-otp', data),
  resetPassword: (data: { email: string; resetToken: string; newPassword: string }) => api.post('/auth/reset-password', data),
};

export const leadsApi = {
  list: (params?: any) => api.get('/leads', { params }),
  get: (id: string) => api.get(`/leads/${id}`),
  create: (data: any) => api.post('/leads', data),
  update: (id: string, data: any) => api.patch(`/leads/${id}`, data),
  delete: (id: string) => api.delete(`/leads/${id}`),
  analyze: (id: string) => api.post(`/leads/${id}/analyze`),
  enrich: (id: string) => api.post(`/leads/${id}/enrich`),
  enrichSignalHire: (id: string) => api.post(`/leads/${id}/enrich/signalhire`),
  enrichApollo: (id: string, personTitles?: string[]) => api.post(`/leads/${id}/enrich/apollo`, personTitles?.length ? { personTitles } : {}),
  generateEmail: (id: string, contact?: { name?: string; title?: string | null }) => api.post(`/leads/${id}/generate-email`, contact || {}),
  sendOutreach: (id: string, data: any) => api.post(`/leads/${id}/send-outreach`, data),
  export: (params?: any) => api.get('/leads/export', { params, responseType: 'blob' }),
  quota: () => api.get('/leads/quota'),
};

export const activitiesApi = {
  list: (params?: any) => api.get('/activities', { params }),
  create: (data: any) => api.post('/activities', data),
  update: (id: string, data: any) => api.put(`/activities/${id}`, data),
  delete: (id: string) => api.delete(`/activities/${id}`),
};

export const emailTemplatesApi = {
  list: () => api.get('/email-templates'),
  create: (data: { name: string; body: string }) => api.post('/email-templates', data),
  update: (id: string, data: { name?: string; body?: string }) => api.patch(`/email-templates/${id}`, data),
  delete: (id: string) => api.delete(`/email-templates/${id}`),
};

export const usersApi = {
  list: () => api.get('/team'),
  get: (id: string) => api.get(`/team/${id}`),
  create: (data: any) => api.post('/team', data),
  update: (id: string, data: any) => api.patch(`/team/${id}`, data),
  deactivate: (id: string) => api.post(`/team/${id}/deactivate`),
  bulkReassignLeads: (data: { fromUserId: string; toUserId: string }) =>
    api.post('/team/bulk-reassign-leads', data),
  delete: (id: string) => api.delete(`/team/${id}`),
};

export const accountsApi = {
  list: (params?: any) => api.get('/accounts', { params }),
  get: (id: string) => api.get(`/accounts/${id}`),
  create: (data: any) => api.post('/accounts', data),
  update: (id: string, data: any) => api.patch(`/accounts/${id}`, data),
  delete: (id: string) => api.delete(`/accounts/${id}`),
};

export const contactsApi = {
  list: (params?: any) => api.get('/contacts', { params }),
  get: (id: string) => api.get(`/contacts/${id}`),
  create: (data: any) => api.post('/contacts', data),
  update: (id: string, data: any) => api.patch(`/contacts/${id}`, data),
  delete: (id: string) => api.delete(`/contacts/${id}`),
};

export const opportunitiesApi = {
  list: (params?: any) => api.get('/opportunities', { params }),
  get: (id: string) => api.get(`/opportunities/${id}`),
  create: (data: any) => api.post('/opportunities', data),
  update: (id: string, data: any) => api.patch(`/opportunities/${id}`, data),
  delete: (id: string) => api.delete(`/opportunities/${id}`),
  moveStage: (id: string, newStage: string) => api.put(`/opportunities/${id}/stage`, { stage: newStage }),
};

export const campaignsApi = {
  list: () => api.get('/campaigns'),
  get: (id: string) => api.get(`/campaigns/${id}`),
  create: (data: any) => api.post('/campaigns', data),
  update: (id: string, data: any) => api.patch(`/campaigns/${id}`, data),
  addLeads: (id: string, leadIds: string[]) => api.post(`/campaigns/${id}/leads`, { leadIds }),
  launch: (id: string) => api.post(`/campaigns/${id}/launch`),
};

export const discoveryApi = {
  startScan: (data?: any) => api.post('/discovery/scan', data || {}),
  smartScan: (prompt: string) => api.post('/discovery/scan/smart', { prompt }),
  parsePrompt: (prompt: string) => api.post('/discovery/parse-prompt', { prompt }),
  startProductScan: (data?: any) => api.post('/discovery/scan/product', data || {}),
  generateProductPrompt: (data: any) => api.post('/discovery/product/generate-prompt', data),
  getActiveScan: () => api.get('/discovery/scan/active'),
  getScanStatus: (jobId: string) => api.get(`/discovery/scan/${jobId}`),
  getScans: () => api.get('/discovery/scans'),
  getSignals: (params?: any) => api.get('/discovery/signals', { params }),
  getServices: () => api.get('/discovery/services'),
  updateServices: (services: any[]) => api.put('/discovery/services', { services }),
};

export const analyticsApi = {
  overview: () => api.get('/analytics/overview'),
  monthly: () => api.get('/analytics/leads/monthly'),
  byStatus: () => api.get('/analytics/leads/status'),
  topSources: () => api.get('/analytics/leads/sources'),
  getCEODashboard: (params?: any) => api.get('/analytics/dashboard/ceo', { params }),
  getManagerDashboard: (params?: any) => api.get('/analytics/dashboard/manager', { params }),
  getSalesDashboard: (params?: any) => api.get('/analytics/dashboard/sales', { params }),
  getDashboard: (params?: any) => api.get('/analytics/dashboard', { params }),
};

export const teamApi = {
  list: () => api.get('/team'),
  invite: (data: any) => api.post('/team', data),
  update: (id: string, data: any) => api.patch(`/team/${id}`, data),
  remove: (id: string) => api.delete(`/team/${id}`),
};

export const invitationsApi = {
  send: (data: { email: string; role: string; managerId?: string }) =>
    api.post('/invitations', data),
  list: () => api.get('/invitations'),
  accept: (data: { token: string; name: string; password: string }) =>
    api.post('/invitations/accept', data),
  revoke: (id: string) => api.delete(`/invitations/${id}`),
};

export const notificationsApi = {
  // Unread only: a notification disappears from the list once it has been read
  list: () => api.get('/notifications', { params: { unreadOnly: true, limit: 500 } }),
  markRead: (ids: string[]) => api.patch('/notifications/read', { ids }),
};

export const dropdownsApi = {
  listAll: () => api.get('/dropdowns/all'),
  listActive: () => api.get('/dropdowns/active'),
  listByCategory: (category: string) => api.get('/dropdowns', { params: { category } }),
  add: (data: any) => api.post('/dropdowns', data),
  update: (id: string, data: any) => api.patch(`/dropdowns/${id}`, data),
  delete: (id: string) => api.delete(`/dropdowns/${id}`),
  seed: () => api.post('/dropdowns/seed'),
  setDefault: (id: string) => api.put(`/dropdowns/${id}/set-default`),
};

export const settingsApi = {
  get: () => api.get('/settings'),
  update: (data: any) => api.patch('/settings', data),
};

export const dashboardApi = {
  getCEODashboard: (params?: any) => api.get('/analytics/dashboard/ceo', { params }),
  getManagerDashboard: (params?: any) => api.get('/analytics/dashboard/manager', { params }),
  getSalesDashboard: () => api.get('/analytics/dashboard/sales'),
};