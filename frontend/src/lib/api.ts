
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

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-refresh on 401
api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as any;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const refresh = localStorage.getItem('refreshToken');
        const { data } = await axios.post(`${API_URL}/auth/refresh`, { refreshToken: refresh });
        localStorage.setItem('accessToken', data.data.accessToken);
        localStorage.setItem('refreshToken', data.data.refreshToken);
        original.headers.Authorization = `Bearer ${data.data.accessToken}`;
        return api(original);
      } catch {
        localStorage.clear();
        window.location.href = '/auth/login';
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
};

export const leadsApi = {
  list: (params?: any) => api.get('/leads', { params }),
  get: (id: string) => api.get(`/leads/${id}`),
  create: (data: any) => api.post('/leads', data),
  update: (id: string, data: any) => api.patch(`/leads/${id}`, data),
  delete: (id: string) => api.delete(`/leads/${id}`),
  analyze: (id: string) => api.post(`/leads/${id}/analyze`),
  enrichSignalHire: (id: string) => api.post(`/leads/${id}/enrich/signalhire`),
  enrichApollo: (id: string) => api.post(`/leads/${id}/enrich/apollo`),
  generateEmail: (id: string) => api.post(`/leads/${id}/generate-email`),
  sendOutreach: (id: string, data: any) => api.post(`/leads/${id}/send-outreach`, data),
  export: () => api.get('/leads/export', { responseType: 'blob' }),
};

export const discoveryApi = {
  startScan: (data?: any) => api.post('/discovery/scan', data || {}),
  startProductScan: (data?: any) => api.post('/discovery/scan/product', data || {}),
  // Step 1: generate AI prompt from product inputs — user reviews/edits before scanning
  generateProductPrompt: (data: any) => api.post('/discovery/product/generate-prompt', data),
  getActiveScan: () => api.get('/discovery/scan/active'),
  getScanStatus: (jobId: string) => api.get(`/discovery/scan/${jobId}`),
  getScans: () => api.get('/discovery/scans'),
  getSignals: (params?: any) => api.get('/discovery/signals', { params }),
  getServices: () => api.get('/discovery/services'),
  updateServices: (services: any[]) => api.put('/discovery/services', { services }),
};

export const campaignsApi = {
  list: () => api.get('/campaigns'),
  get: (id: string) => api.get(`/campaigns/${id}`),
  create: (data: any) => api.post('/campaigns', data),
  update: (id: string, data: any) => api.patch(`/campaigns/${id}`, data),
  addLeads: (id: string, leadIds: string[]) => api.post(`/campaigns/${id}/leads`, { leadIds }),
  launch: (id: string) => api.post(`/campaigns/${id}/launch`),
};

export const analyticsApi = {
  overview: () => api.get('/analytics/overview'),
  monthly: () => api.get('/analytics/leads/monthly'),
  byStatus: () => api.get('/analytics/leads/status'),
  topSources: () => api.get('/analytics/leads/sources'),
};

export const teamApi = {
  list: () => api.get('/team'),
  invite: (data: any) => api.post('/team', data),
  update: (id: string, data: any) => api.patch(`/team/${id}`, data),
  remove: (id: string) => api.delete(`/team/${id}`),
};