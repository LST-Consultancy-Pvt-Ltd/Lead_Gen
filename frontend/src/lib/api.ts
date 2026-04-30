
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

// Auto-refresh on 401 & Global 403 handling
let isRefreshing = false;
let failedQueue: any[] = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as any;
    
    // Handle 401 - Unauthorized (Token expired)
    if (error.response?.status === 401 && !original._retry) {
      if (isRefreshing) {
        // Queue requests while refresh is in progress
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          original.headers.Authorization = `Bearer ${token}`;
          return api(original);
        }).catch((err) => {
          return Promise.reject(err);
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        const refresh = localStorage.getItem('refreshToken');
        
        if (!refresh) {
          throw new Error('No refresh token available');
        }

        console.log('Attempting to refresh token...');
        const { data } = await axios.post(`${API_URL}/auth/refresh`, { refreshToken: refresh });
        
        const newAccessToken = data.data?.accessToken || data.accessToken;
        const newRefreshToken = data.data?.refreshToken || data.refreshToken;
        
        if (!newAccessToken) {
          throw new Error('No access token in refresh response');
        }

        localStorage.setItem('accessToken', newAccessToken);
        if (newRefreshToken) {
          localStorage.setItem('refreshToken', newRefreshToken);
        }
        
        original.headers.Authorization = `Bearer ${newAccessToken}`;
        processQueue(null, newAccessToken);
        isRefreshing = false;
        
        console.log('Token refreshed successfully');
        return api(original);
      } catch (refreshError: any) {
        console.error('Token refresh failed:', refreshError);
        processQueue(refreshError, null);
        isRefreshing = false;
        
        // Only logout if refresh token is actually invalid
        if (refreshError.response?.status === 401 || refreshError.response?.status === 403) {
          if (typeof window !== 'undefined') {
            localStorage.clear();
            toast.error('Your session has expired. Please log in again.');
            setTimeout(() => {
              window.location.href = '/auth/login';
            }, 1000);
          }
        }
        
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
  generateEmail: (id: string) => api.post(`/leads/${id}/generate-email`),
  sendOutreach: (id: string, data: any) => api.post(`/leads/${id}/send-outreach`, data),
  export: (params?: any) => api.get('/leads/export', { params, responseType: 'blob' }),
  quota: () => api.get('/leads/quota'),
};

export const activitiesApi = {
  list: (params?: any) => api.get('/activities', { params }),
  create: (data: any) => api.post('/activities', data),
  update: (id: string, data: any) => api.patch(`/activities/${id}`, data),
  delete: (id: string) => api.delete(`/activities/${id}`),
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

export const importApi = {
  upload: (formData: FormData) => api.post('/import/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  importLeads: (formData: FormData) => api.post('/import/leads', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  getLogs: () => api.get('/import/logs'),
  getHistory: () => api.get('/import/history'),
  getTemplate: () => api.get('/import/template', { responseType: 'blob' }),
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
  list: () => api.get('/notifications'),
  markRead: (ids: string[]) => api.patch('/notifications/read', { ids }),
};

export const dropdownsApi = {
  listAll: () => api.get('/dropdowns/all'),
  listActive: () => api.get('/dropdowns/active'),
  listByCategory: (category: string) => api.get('/dropdowns', { params: { category } }),
  add: (data: any) => api.post('/dropdowns', data),
  update: (id: string, data: any) => api.patch(`/dropdowns/${id}`, data),
  delete: (id: string) => api.delete(`/dropdowns/${id}`),
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