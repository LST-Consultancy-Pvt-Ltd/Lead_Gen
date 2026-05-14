'use client';
import React from 'react';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leadsApi, usersApi, dropdownsApi, api } from '../../../lib/api';
import { Badge, Avatar, ScoreRing, Spinner, EmptyState } from '../../../components/ui';
import { CreateLeadModal } from '../../../components/crm/CreateLeadModal';
import { RoleGuard } from '../../../components/common/RoleGuard';
import { usePermissions } from '../../../lib/rbac';
import { usePermissions as useAuthPermissions } from '../../../store/authStore';
import { useAuthStore } from '../../../store/authStore';
import { getInitials, downloadBlob, statusColors } from '../../../lib/utils';
import { Users, Plus, Download, Search, Trash2, Edit2, UserCog, X, Loader2, Clock, CalendarDays, Lock, Upload, CheckCircle2 } from 'lucide-react';
import { isToday, isPast, isTomorrow, format, parseISO } from 'date-fns';
import Link from 'next/link';
import toast from 'react-hot-toast';

export default function LeadsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignToId, setAssignToId] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const permissions = usePermissions();
  const authPerms = useAuthPermissions();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  // Fetch team members for owner filter (only for managers/admins)
  const { data: usersData } = useQuery({
    queryKey: ['users-filter'],
    queryFn: () => usersApi.list().then(r => r.data?.data ?? r.data ?? []),
    enabled: authPerms.canViewTeam,
  });

  // Build query params based on role
  const queryParams: any = {
    page,
    limit: 20,
    search: search || undefined,
    status: statusFilter || undefined,
  };

  // Sales users only see their own leads
  if (!permissions.canViewAllLeads) {
    queryParams.assignedToMe = true;
  } else if (ownerFilter === 'unassigned') {
    queryParams.unassigned = true;
  } else if (ownerFilter) {
    queryParams.assignedTo = ownerFilter;
  } else if (authPerms.isManager) {
    queryParams.includeUnassigned = true;
  }

  const { data, isLoading } = useQuery({
    queryKey: ['leads', queryParams],
    queryFn: () => leadsApi.list(queryParams).then(r => r.data),
    placeholderData: (prev) => prev,
  });

  const { data: quota, isLoading: isQuotaLoading } = useQuery({
    queryKey: ['lead-quota'],
    queryFn: () => leadsApi.quota().then(r => r.data?.data),
    staleTime: 60000,
  });

  const { data: leadStatusOptions } = useQuery({
    queryKey: ['dropdowns-lead-status'],
    queryFn: () => dropdownsApi.listByCategory('lead_status').then(r => {
      const d = r.data;
      if (Array.isArray(d)) return d;
      if (Array.isArray(d?.data)) return d.data;
      return [];
    }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => leadsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Lead deleted successfully');
      setDeleteConfirm(null);
    },
    onError: () => {
      toast.error('Failed to delete lead');
    },
  });

  const assignMutation = useMutation({
    mutationFn: async (userId: string) => {
      await Promise.all(
        Array.from(selectedLeads).map(id => leadsApi.update(id, { assignedToId: userId }))
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(`${selectedLeads.size} lead${selectedLeads.size > 1 ? 's' : ''} assigned successfully`);
      setSelectedLeads(new Set());
      setAssignOpen(false);
      setAssignToId('');
    },
    onError: () => toast.error('Failed to assign leads'),
  });

  async function handleExport() {
    try {
      const ids = selectedLeads.size > 0 ? Array.from(selectedLeads) : undefined;
      const params: any = {};

      // If specific leads are selected, export only those
      if (ids && ids.length > 0) {
        params.ids = ids.join(',');
      } else {
        // Otherwise, export with current filters
        if (search) params.search = search;
        if (statusFilter) params.status = statusFilter;

        // Apply role-based filters
        if (!permissions.canViewAllLeads) {
          params.assignedToMe = true;
        } else if (ownerFilter === 'unassigned') {
          params.unassigned = true;
        } else if (ownerFilter) {
          params.assignedTo = ownerFilter;
        }
      }

      const resp = await leadsApi.export(params);
      downloadBlob(resp.data, 'leads.csv');
      toast.success('CSV exported');
    } catch {
      toast.error('Export failed');
    }
  }

  async function handleImport() {
    if (!importFile) return;
    setImporting(true);
    setImportErrors([]);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const resp = await api.post('/import/leads/excel', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(
        `${resp.data.successRows} lead${resp.data.successRows !== 1 ? 's' : ''} imported successfully`
      );
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setImportOpen(false);
      setImportFile(null);
      setImportErrors([]);
    } catch (err: any) {
      const errData = err?.response?.data;
      if (Array.isArray(errData?.errors) && errData.errors.length > 0) {
        setImportErrors(errData.errors);
      } else {
        toast.error(errData?.message || 'Import failed');
      }
    } finally {
      setImporting(false);
    }
  }

  async function handleDownloadTemplate() {
    try {
      const resp = await api.get('/import/template/excel', { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([resp.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'crm-import-template.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download template');
    }
  }

  function handleFileDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx' && ext !== 'xls') {
      toast.error('Only Excel files (.xlsx, .xls) are allowed');
      return;
    }
    setImportFile(file);
    setImportErrors([]);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx' && ext !== 'xls') {
      toast.error('Only Excel files (.xlsx, .xls) are allowed');
      e.target.value = '';
      return;
    }
    setImportFile(file);
    setImportErrors([]);
  }

  function handleDelete(id: string) {
    if (deleteConfirm === id) {
      deleteMutation.mutate(id);
    } else {
      setDeleteConfirm(id);
      setTimeout(() => setDeleteConfirm(null), 3000);
    }
  }

  function toggleSelect(id: string) {
    setSelectedLeads(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const allIds = (data?.data as any[])?.map((l: any) => l.id) ?? [];
    if (selectedLeads.size === allIds.length && allIds.length > 0) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(allIds));
    }
  }

  const leads = (data?.data as any[]) ?? [];
  const pagination = data?.pagination ?? null;
  const total = pagination?.total ?? 0;
  const totalPages = pagination?.totalPages ?? 1;

  function getFollowUpInfo(dateStr?: string | null) {
    if (!dateStr) return null;
    const date = parseISO(dateStr);
    if (isToday(date)) {
      return { label: 'Today', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', dot: 'bg-amber-400', urgency: 'today' };
    }
    if (isPast(date)) {
      return { label: `Overdue · ${format(date, 'dd MMM')}`, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', dot: 'bg-red-400', urgency: 'overdue' };
    }
    if (isTomorrow(date)) {
      return { label: 'Tomorrow', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', dot: 'bg-emerald-400', urgency: 'future' };
    }
    return { label: format(date, 'dd MMM'), color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', dot: 'bg-emerald-400', urgency: 'future' };
  }

  // Determine page title based on role
  const pageTitle = permissions.canViewAllLeads ? 'All Leads' : 'My Leads';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">{pageTitle}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {total.toLocaleString()} {permissions.canViewAllLeads ? 'total leads' : 'leads assigned to you'}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {!isQuotaLoading && quota && (
            <div className="mr-4 flex flex-col items-end hidden sm:flex">
                <div className="flex justify-between w-32 mb-1">
                    <span className="text-[10px] font-medium text-slate-500">Lead Quota</span>
                    <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">
                        {quota.used} / {quota.quota}
                    </span>
                </div>
                <div className="h-1.5 w-32 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-500 ${quota.used >= quota.quota ? 'bg-red-500' : 'bg-blue-500'}`}
                        style={{ width: `${Math.min(100, Math.max(0, (quota.used / quota.quota) * 100))}%` }}
                    />
                </div>
            </div>
          )}

          {permissions.canReassignLead && (
            <button
              className={`btn-ghost transition-opacity ${selectedLeads.size === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
              onClick={() => selectedLeads.size > 0 && setAssignOpen(true)}
              disabled={selectedLeads.size === 0}
              title={selectedLeads.size === 0 ? 'Select leads to assign' : `Assign ${selectedLeads.size} lead(s)`}
            >
              <UserCog size={14} />
              {selectedLeads.size > 0 ? `Assign (${selectedLeads.size})` : 'Assign'}
            </button>
          )}
          {total > 0 && (
            <RoleGuard permission="canExportData">
              <button className="btn-ghost" onClick={handleExport}>
                <Download size={14} /> Export CSV
              </button>
            </RoleGuard>
          )}
          <button className="btn-ghost" onClick={() => setImportOpen(true)}>
            <Upload size={14} /> Import Excel
          </button>
          <RoleGuard permission="canCreateLead">
            <button
                className="btn-primary"
                onClick={() => setIsCreateModalOpen(true)}
                disabled={quota?.used >= quota?.quota}
                title={quota?.used >= quota?.quota ? 'Lead quota limit reached' : ''}
            >
              {quota?.used >= quota?.quota ? <Lock size={14} /> : <Plus size={14} />} Add Lead
            </button>
          </RoleGuard>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="input pl-8 h-9 w-48 text-xs"
            placeholder="Search leads…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select className="input h-9 text-xs w-auto" title="Filter by status" value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All Status</option>
          {(Array.isArray(leadStatusOptions) ? leadStatusOptions : [])
            .filter((opt: any) => opt.isActive !== false)
            .map((opt: any) => (
              <option key={opt.id} value={opt.value}>{opt.value}</option>
            ))
          }
        </select>
        <RoleGuard permission="canViewAllLeads">
          <select className="input h-9 text-xs w-auto" title="Filter by owner" value={ownerFilter}
            onChange={e => { setOwnerFilter(e.target.value); setPage(1); }}>
            <option value="">All Owners</option>
            <option value="unassigned">Unassigned</option>
            {(Array.isArray(usersData) ? usersData : []).map((u: any) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </RoleGuard>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Spinner size={24} />
          </div>
        ) : leads.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No leads found"
            description={permissions.canViewAllLeads ?
              "No leads match your current filters" :
              "You don't have any leads assigned yet. Contact your manager."}
            // action={
            //   permissions.canCreateLead ? (
            //     <button onClick={() => setIsCreateModalOpen(true)} className="btn-primary">
            //       <Plus size={14} /> Add Lead
            //     </button>
            //   ) : undefined
            // }
          />
        ) : (
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)]">
            <table className="w-full">
              <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
                <tr className="border-b border-slate-200 dark:border-white/[0.06]">
                  {permissions.canReassignLead && (
                    <th className="px-4 py-3 w-8">
                      <input
                        type="checkbox"
                        title="Select all"
                        className="w-4 h-4 rounded border-white/20 bg-slate-200 dark:bg-slate-800 accent-blue-500 cursor-pointer"
                        checked={leads.length > 0 && selectedLeads.size === leads.length}
                        ref={(el) => { if (el) el.indeterminate = selectedLeads.size > 0 && selectedLeads.size < leads.length; }}
                        onChange={toggleSelectAll}
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Company
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Contact
                  </th>
                  <RoleGuard permission="canViewAllLeads">
                    <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                      Assign To
                    </th>
                  </RoleGuard>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Score
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Product / Services
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Source URL
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Next Follow-up
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l: any) => (
                  <tr key={l.id} className={`border-b border-slate-200 dark:border-white/[0.04] hover:bg-slate-200/30 dark:hover:bg-slate-800/30 transition-colors ${selectedLeads.has(l.id) ? 'bg-blue-500/5' : ''}`}>
                    {permissions.canReassignLead && (
                      <td className="px-4 py-3 w-8">
                        <input
                          type="checkbox"
                          title="Select lead"
                          className="w-4 h-4 rounded border-white/20 bg-slate-200 dark:bg-slate-800 accent-blue-500 cursor-pointer"
                          checked={selectedLeads.has(l.id)}
                          onChange={() => toggleSelect(l.id)}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/leads/${l.id}`} className="flex items-center gap-2.5">
                        <Avatar initials={getInitials(l.companyName)} size="sm" />
                        <div>
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{l.companyName}</p>
                          <p className="text-xs text-slate-500">{l.industry || 'Unknown'}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-slate-800 dark:text-slate-200">{l.contactName || '—'}</p>
                      <p className="text-xs text-slate-500">{l.contactEmail}</p>
                    </td>
                    <RoleGuard permission="canViewAllLeads">
                      <td className="px-4 py-3 text-xs text-slate-400">
                        {l.assignedTo?.name || 'Unassigned'}
                      </td>
                    </RoleGuard>
                    <td className="px-4 py-3">
                      <ScoreRing score={l.leadScore} size={36} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={statusColors[l.status] ?? 'gray'}>
                        {l.status?.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {(l.leadType === 'product' || l.subSource === 'product') ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-violet-500/10 text-violet-400 border border-violet-500/20">Product</span>
                      ) : (l.leadType === 'position' || l.subSource === 'position') ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">Services</span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>

                    {/* Source URL */}
                    <td className="px-4 py-3">
                      {(() => {
                        const url = l.sourceUrl || (l.website ? (l.website.startsWith('http') ? l.website : `https://${l.website}`) : '');
                        return url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 hover:underline max-w-[140px] truncate"
                            title={url}
                          >
                            View Source
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        );
                      })()}
                    </td>

                    <td className="px-4 py-3">
                      {(() => {
                        const info = getFollowUpInfo(l.followUpDate);
                        if (!info) return <span className="text-xs text-slate-600">—</span>;
                        return (
                          <div className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border ${info.bg}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${info.dot} ${info.urgency === 'overdue' ? 'animate-pulse' : ''}`} />
                            {info.urgency === 'overdue' ? <Clock size={11} className={info.color} /> : <CalendarDays size={11} className={info.color} />}
                            <span className={info.color}>{info.label}</span>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link href={`/dashboard/leads/${l.id}`} className="btn-ghost text-xs py-1 px-2">
                          View
                        </Link>
                        {(permissions.canEditAllLeads || (permissions.canEditOwnLeads && l.assignedTo?.id === user?.id)) && (
                          <Link href={`/dashboard/leads/${l.id}?edit=1`} className="btn-ghost text-xs py-1 px-2">
                            <Edit2 size={12} /> Edit
                          </Link>
                        )}
                        <RoleGuard permission="canDeleteLead">
                          <button
                            onClick={() => handleDelete(l.id)}
                            className={`btn-ghost text-xs py-1 px-2 ${
                              deleteConfirm === l.id ? 'bg-red-500/20 text-red-400' : 'text-slate-400'
                            }`}
                          >
                            {deleteConfirm === l.id ? (
                              <>
                                <Trash2 size={12} /> Confirm?
                              </>
                            ) : (
                              <Trash2 size={12} />
                            )}
                          </button>
                        </RoleGuard>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">{total} total leads</span>
          <div className="flex gap-1">
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                  p === page
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                    : 'text-slate-500 hover:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Assign Leads Modal */}
      {assignOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setAssignOpen(false)} />
          <div className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Assign Leads</h3>
                <p className="text-xs text-slate-500 mt-0.5">{selectedLeads.size} lead{selectedLeads.size > 1 ? 's' : ''} selected</p>
              </div>
              <button title="Close" onClick={() => setAssignOpen(false)} className="text-slate-500 hover:text-slate-500 dark:hover:text-slate-300">
                <X size={16} />
              </button>
            </div>
            <div>
              <label className="label mb-1.5 block">Assign To</label>
              <select
                title="Select assignee"
                className="input text-sm"
                value={assignToId}
                onChange={e => setAssignToId(e.target.value)}
              >
                <option value="">Select a team member...</option>
                {(Array.isArray(usersData) ? usersData : []).map((u: any) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role?.replace(/_/g, ' ')})</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                className="btn-primary flex-1"
                onClick={() => assignMutation.mutate(assignToId)}
                disabled={!assignToId || assignMutation.isPending}
              >
                {assignMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <UserCog size={14} />}
                Assign
              </button>
              <button className="btn-ghost" onClick={() => setAssignOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Import Excel Modal */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { setImportOpen(false); setImportFile(null); setImportErrors([]); }}
          />
          <div
            className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Import Leads from Excel
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Upload .xlsx or .xls file</p>
              </div>
              <button
                type="button"
                title="Close"
                onClick={() => { setImportOpen(false); setImportFile(null); setImportErrors([]); }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 mt-0.5"
              >
                <X size={16} />
              </button>
            </div>

            {/* Download Template */}
            <button
              type="button"
              className="btn-ghost w-full mb-4"
              onClick={handleDownloadTemplate}
            >
              <Download size={14} /> Download Excel Template
            </button>

            {/* Drag & Drop Zone */}
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                isDragging
                  ? 'border-blue-400 bg-blue-500/10'
                  : importFile
                  ? 'border-emerald-400 bg-emerald-500/10'
                  : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
              }`}
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleFileDrop}
              onClick={() => document.getElementById('excel-file-input')?.click()}
            >
              <input
                id="excel-file-input"
                type="file"
                accept=".xlsx,.xls"
                aria-label="Upload Excel file"
                title="Upload Excel file"
                className="hidden"
                onChange={handleFileSelect}
              />
              {importFile ? (
                <>
                  <CheckCircle2 size={28} className="mx-auto mb-2 text-emerald-400" />
                  <p className="text-sm font-medium text-emerald-400 break-all">{importFile.name}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {(importFile.size / 1024).toFixed(0)} KB
                  </p>
                </>
              ) : (
                <>
                  <Upload size={28} className="mx-auto mb-2 text-slate-400" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Drag &amp; drop Excel file here
                  </p>
                  <p className="text-xs text-slate-500 mt-1">or click to browse</p>
                </>
              )}
            </div>

            <p className="text-xs text-slate-500 mt-2 text-center">
              Only .xlsx and .xls files accepted · Max 10MB
            </p>

            {/* Error list */}
            {importErrors.length > 0 && (
              <div className="mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 max-h-36 overflow-y-auto">
                <p className="text-xs font-semibold text-red-400 mb-1.5">
                  Import failed — fix these errors:
                </p>
                <ul className="space-y-0.5">
                  {importErrors.map((msg, i) => (
                    <li key={i} className="text-xs text-red-400">• {msg}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={!importFile || importing}
                onClick={handleImport}
              >
                {importing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Importing...
                  </>
                ) : (
                  <>
                    <Upload size={14} /> Import Leads
                  </>
                )}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => { setImportOpen(false); setImportFile(null); setImportErrors([]); }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      <CreateLeadModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
    </div>
  );
}
