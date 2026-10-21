'use client';
import React from 'react';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leadsApi, usersApi, dropdownsApi, api } from '../../../lib/api';
import { Badge, Avatar, ScoreRing, Spinner, EmptyState, Pagination } from '../../../components/ui';
import { CreateLeadModal } from '../../../components/crm/CreateLeadModal';
import { RoleGuard } from '../../../components/common/RoleGuard';
import { usePermissions } from '../../../lib/rbac';
import { usePermissions as useAuthPermissions } from '../../../store/authStore';
import { useAuthStore } from '../../../store/authStore';
import { getInitials, downloadBlob, statusColors, normalizeLeadType, formatLabel, pluralize, assignableUsers } from '../../../lib/utils';
import { Users, Plus, Download, Search, Trash2, Edit2, Eye, UserCog, X, Loader2, Clock, CalendarDays, Upload, CheckCircle2, ArrowUp, ArrowDown, CircleDot, UserCircle, AlertTriangle, FileSpreadsheet, ExternalLink, Package, Briefcase, Sparkles, Hand, Tag } from 'lucide-react';
import { PageHero } from '../../../components/ui/PageHero';
import { FilterSelect } from '../../../components/dashboards/DashboardUI';
import { isToday, isPast, isTomorrow, format, parseISO } from 'date-fns';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Select } from '../../../components/ui/Select';

export default function LeadsPage() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignToId, setAssignToId] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [statusPopup, setStatusPopup] = useState<{
    count: number;
    rows: { row: number; invalidValue: string; validOptions: string }[];
  } | null>(null);
  const [sourcePopup, setSourcePopup] = useState<{
    count: number;
    rows: { row: number; invalidValue: string; validOptions: string }[];
  } | null>(null);
  const [fieldPopup, setFieldPopup] = useState<{
    rows: { row: number; field: string; invalidValue: string; reason: string }[];
  } | null>(null);
  const [missingPopup, setMissingPopup] = useState<{
    rows: { row: number; missingFields: string[] }[];
  } | null>(null);

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
    limit,
    search: search || undefined,
    status: statusFilter || undefined,
    sortBy,
    sortDir,
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
      downloadBlob(resp.data, 'leads.xlsx');
      toast.success('Excel exported');
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
      const statusErrors  = Array.isArray(resp.data.statusErrors)  ? resp.data.statusErrors  : [];
      const sourceErrors  = Array.isArray(resp.data.sourceErrors)  ? resp.data.sourceErrors  : [];
      const missingErrors = Array.isArray(resp.data.missingErrors) ? resp.data.missingErrors : [];
      const fieldErrors   = Array.isArray(resp.data.fieldErrors)   ? resp.data.fieldErrors   : [];

      const imported = Number(resp.data.successRows) || 0;
      const skipped = Number(resp.data.failedRows) || 0;
      if (imported > 0) {
        toast.success(`${imported} lead${imported !== 1 ? 's' : ''} imported successfully${skipped ? ` · ${skipped} skipped` : ''}`);
      } else {
        toast.error(skipped ? `No leads imported — ${skipped} row${skipped !== 1 ? 's were' : ' was'} skipped` : 'No leads found in the file');
      }
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      await queryClient.refetchQueries({ queryKey: ['leads'] });

      if (statusErrors.length > 0) {
        setStatusPopup({
          count: statusErrors.length,
          rows: statusErrors.map((e: any) => ({
            row: e.row,
            invalidValue: e.invalidValue ?? '',
            validOptions: e.validOptions ?? '',
          })),
        });
      }
      if (sourceErrors.length > 0) {
        setSourcePopup({
          count: sourceErrors.length,
          rows: sourceErrors.map((e: any) => ({
            row: e.row,
            invalidValue: e.invalidValue ?? '',
            validOptions: e.validOptions ?? '',
          })),
        });
      }
      if (missingErrors.length > 0) {
        setMissingPopup({
          rows: missingErrors.map((e: any) => ({
            row: e.row,
            missingFields: Array.isArray(e.missingFields) ? e.missingFields : [],
          })),
        });
      }
      if (fieldErrors.length > 0) {
        setFieldPopup({
          rows: fieldErrors.map((e: any) => ({
            row: e.row,
            field: e.field ?? '',
            invalidValue: e.invalidValue ?? '',
            reason: e.reason ?? '',
          })),
        });
      }
      if (statusErrors.length === 0 && sourceErrors.length === 0 && missingErrors.length === 0 && fieldErrors.length === 0) {
        setImportOpen(false);
        setImportFile(null);
        setImportErrors([]);
      }
    } catch (err: any) {
      const errData = err?.response?.data;
      if (Array.isArray(errData?.errors) && errData.errors.length > 0) {
        setImportErrors(errData.errors.map((e: any) => (typeof e === 'string' ? e : e.error || JSON.stringify(e))));
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
    // OLD two-click confirm logic - replaced by popup (do not remove)
    // if (deleteConfirm === id) {
    //   deleteMutation.mutate(id);
    // } else {
    //   setDeleteConfirm(id);
    //   setTimeout(() => setDeleteConfirm(null), 3000);
    // }
    setDeleteConfirm(id);
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

  function handleSort(field: string) {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
    setPage(1);
  }

  function sortIndicator(field: string) {
    if (sortBy !== field) return null;
    return sortDir === 'asc'
      ? <ArrowUp size={11} className="inline ml-1 text-blue-600 dark:text-blue-400" />
      : <ArrowDown size={11} className="inline ml-1 text-blue-600 dark:text-blue-400" />;
  }

  function getFollowUpInfo(dateStr?: string | null) {
    if (!dateStr) return null;
    const date = parseISO(dateStr);
    if (isToday(date)) {
      return { label: 'Today', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-500/10 border-amber-500/20', dot: 'bg-amber-500', urgency: 'today' };
    }
    if (isPast(date)) {
      return { label: `Overdue · ${format(date, 'dd MMM')}`, color: 'text-rose-700 dark:text-rose-300', bg: 'bg-rose-500/10 border-rose-500/20', dot: 'bg-rose-500', urgency: 'overdue' };
    }
    if (isTomorrow(date)) {
      return { label: 'Tomorrow', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-500/10 border-emerald-500/20', dot: 'bg-emerald-500', urgency: 'future' };
    }
    return { label: format(date, 'dd MMM'), color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-500/10 border-emerald-500/20', dot: 'bg-emerald-500', urgency: 'future' };
  }

  // Determine page title based on role
  const pageTitle = permissions.canViewAllLeads ? 'All Leads' : 'My Leads';

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHero
        icon={Users}
        eyebrow="Lead Management"
        title={pageTitle}
        subtitle={permissions.canViewAllLeads ? pluralize(total, 'total lead', 'total leads') : `${pluralize(total, 'lead', 'leads')} assigned to you`}
      >
        <div className="flex gap-2 flex-wrap items-center">
          {!isQuotaLoading && quota && (
            <div className="hidden sm:block rounded-xl bg-white/10 ring-1 ring-white/20 backdrop-blur px-4 py-2.5 min-w-[180px]">
              <div className="flex justify-between items-center gap-3 mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-100">Lead Quota</span>
                <span className="font-display text-sm font-semibold text-white tabular-nums">
                  {quota.used} <span className="text-blue-200/80 font-medium">/ {quota.quota}</span>
                </span>
              </div>
              <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${quota.used >= quota.quota ? 'bg-rose-300' : 'bg-gradient-to-r from-emerald-300 to-cyan-200'}`}
                  style={{ width: `${Math.min(100, Math.max(0, (quota.used / quota.quota) * 100))}%` }}
                />
              </div>
            </div>
          )}

          {permissions.canReassignLead && (
            <button
              className={`inline-flex items-center gap-2 h-10 px-3.5 rounded-xl text-sm font-medium text-white bg-white/10 ring-1 ring-white/20 backdrop-blur hover:bg-white/20 transition-all ${selectedLeads.size === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
              onClick={() => selectedLeads.size > 0 && setAssignOpen(true)}
              disabled={selectedLeads.size === 0}
              title={selectedLeads.size === 0 ? 'Select leads to assign' : `Assign ${selectedLeads.size} lead(s)`}
            >
              <UserCog size={15} />
              {selectedLeads.size > 0 ? `Assign (${selectedLeads.size})` : 'Assign'}
            </button>
          )}
          {total > 0 && (
            <RoleGuard permission="canExportData">
              <button className="inline-flex items-center gap-2 h-10 px-3.5 rounded-xl text-sm font-medium text-white bg-white/10 ring-1 ring-white/20 backdrop-blur hover:bg-white/20 transition-all" onClick={handleExport}>
                <Download size={15} /> Export Excel
              </button>
            </RoleGuard>
          )}
          <RoleGuard permission="canImportData">
            <button className="inline-flex items-center gap-2 h-10 px-3.5 rounded-xl text-sm font-medium text-white bg-white/10 ring-1 ring-white/20 backdrop-blur hover:bg-white/20 transition-all" onClick={() => setImportOpen(true)}>
            <Upload size={15} /> Import Excel
          </button>
          </RoleGuard>
          <RoleGuard permission="canCreateLead">
            <button
              className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-white text-indigo-700 font-semibold text-sm shadow-lg shadow-indigo-900/20 hover:bg-blue-50 hover:-translate-y-px transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              onClick={() => setIsCreateModalOpen(true)}
            >
              <Plus size={16} /> Add Lead
            </button>
          </RoleGuard>
        </div>
      </PageHero>

      {/* Filters */}
      <div className="card p-3 flex gap-2.5 flex-wrap items-center">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center bg-blue-500/10 text-blue-600 dark:text-blue-400 z-10">
            <Search size={14} />
          </span>
          <input
            className="input pl-10 h-10 text-[13px]"
            placeholder="Search leads…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <FilterSelect icon={CircleDot} tone="violet" className="w-52" title="Filter by status" value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All Status</option>
          {(Array.isArray(leadStatusOptions) ? leadStatusOptions : [])
            .filter((opt: any) => opt.isActive !== false)
            .map((opt: any) => (
              <option key={opt.id} value={opt.value}>{opt.value}</option>
            ))
          }
        </FilterSelect>
        <RoleGuard permission="canViewAllLeads">
          <FilterSelect icon={UserCircle} tone="emerald" className="w-52" title="Filter by owner" value={ownerFilter}
            onChange={e => { setOwnerFilter(e.target.value); setPage(1); }}>
            <option value="">All Owners</option>
            <option value="unassigned">Unassigned</option>
            {assignableUsers(usersData as any[], user).map((u: any) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </FilterSelect>
        </RoleGuard>
        {selectedLeads.size > 0 && (
          <span className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-blue-500/10 text-blue-700 dark:text-blue-300">
            <CheckCircle2 size={13} /> {selectedLeads.size} selected
          </span>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="divide-y divide-slate-100 dark:divide-white/[0.04] animate-pulse" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="w-8 h-8 rounded-full bg-slate-200/80 dark:bg-white/[0.06]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/4 rounded bg-slate-200/80 dark:bg-white/[0.06]" />
                  <div className="h-2.5 w-1/6 rounded bg-slate-200/60 dark:bg-white/[0.04]" />
                </div>
                <div className="h-6 w-20 rounded-md bg-slate-200/60 dark:bg-white/[0.04]" />
              </div>
            ))}
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
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-surface-2">
                <tr className="border-b border-line">
                  {(permissions.canReassignLead || permissions.canExportData) && (
                    <th className="pl-5 pr-2 py-3.5 w-8">
                      <input
                        type="checkbox"
                        title="Select all"
                        className="w-4 h-4 rounded-md border-slate-300 dark:border-white/20 accent-blue-600 cursor-pointer"
                        checked={leads.length > 0 && selectedLeads.size === leads.length}
                        ref={(el) => { if (el) el.indeterminate = selectedLeads.size > 0 && selectedLeads.size < leads.length; }}
                        onChange={toggleSelectAll}
                      />
                    </th>
                  )}
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-ink-3 uppercase tracking-[0.08em] whitespace-nowrap">
                    {permissions.canDeleteLead ? 'View | Edit | Delete' : 'View | Edit'}
                  </th>
                  <th
                    className="px-4 py-3.5 text-left text-[11px] font-semibold text-ink-3 uppercase tracking-[0.08em] whitespace-nowrap cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    onClick={() => handleSort('industry')}
                    title="Sort by industry"
                  >
                    Company{sortIndicator('industry')}
                  </th>
                  <th
                    className="px-4 py-3.5 text-left text-[11px] font-semibold text-ink-3 uppercase tracking-[0.08em] whitespace-nowrap cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    onClick={() => handleSort('contactName')}
                  >
                    Contact{sortIndicator('contactName')}
                  </th>
                  <RoleGuard permission="canViewAllLeads">
                    <th
                      className="px-4 py-3.5 text-left text-[11px] font-semibold text-ink-3 uppercase tracking-[0.08em] whitespace-nowrap cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      onClick={() => handleSort('assignedTo')}
                    >
                      Assign To{sortIndicator('assignedTo')}
                    </th>
                  </RoleGuard>
                  <th
                    className="px-4 py-3.5 text-left text-[11px] font-semibold text-ink-3 uppercase tracking-[0.08em] whitespace-nowrap cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    onClick={() => handleSort('leadScore')}
                  >
                    Score{sortIndicator('leadScore')}
                  </th>
                  <th
                    className="px-4 py-3.5 text-left text-[11px] font-semibold text-ink-3 uppercase tracking-[0.08em] whitespace-nowrap cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    onClick={() => handleSort('status')}
                  >
                    Status{sortIndicator('status')}
                  </th>
                  <th
                    className="px-4 py-3.5 text-left text-[11px] font-semibold text-ink-3 uppercase tracking-[0.08em] whitespace-nowrap cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    onClick={() => handleSort('leadType')}
                  >
                    Product / Services{sortIndicator('leadType')}
                  </th>
                  <th
                    className="px-4 py-3.5 text-left text-[11px] font-semibold text-ink-3 uppercase tracking-[0.08em] whitespace-nowrap cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    onClick={() => handleSort('createdBy')}
                  >
                    Lead Created By{sortIndicator('createdBy')}
                  </th>
                  <th
                    className="px-4 py-3.5 text-left text-[11px] font-semibold text-ink-3 uppercase tracking-[0.08em] whitespace-nowrap cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    onClick={() => handleSort('keyword')}
                  >
                    Keyword{sortIndicator('keyword')}
                  </th>
                  <th
                    className="px-4 py-3.5 text-left text-[11px] font-semibold text-ink-3 uppercase tracking-[0.08em] whitespace-nowrap cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    onClick={() => handleSort('sourceUrl')}
                  >
                    Source URL{sortIndicator('sourceUrl')}
                  </th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-ink-3 uppercase tracking-[0.08em] whitespace-nowrap">
                    Origin
                  </th>
                  <th
                    className="px-4 py-3.5 text-left text-[11px] font-semibold text-ink-3 uppercase tracking-[0.08em] whitespace-nowrap cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    onClick={() => handleSort('followUpDate')}
                  >
                    Next Follow-up{sortIndicator('followUpDate')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l: any) => (
                  <tr key={l.id} className={`group border-b border-slate-100 dark:border-white/[0.04] transition-colors ${selectedLeads.has(l.id) ? 'bg-blue-50/80 dark:bg-blue-500/[0.08]' : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]'}`}>
                    {(permissions.canReassignLead || permissions.canExportData) && (
                      <td className="pl-5 pr-2 py-3.5 w-8">
                        <input
                          type="checkbox"
                          title="Select lead"
                          className="w-4 h-4 rounded-md border-slate-300 dark:border-white/20 accent-blue-600 cursor-pointer"
                          checked={selectedLeads.has(l.id)}
                          onChange={() => toggleSelect(l.id)}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <Link href={`/dashboard/leads/${l.id}`} className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors" title="View" aria-label="View">
                          <Eye size={14} />
                        </Link>
                        {(permissions.canEditAllLeads || (permissions.canEditOwnLeads && l.assignedTo?.id === user?.id)) && (
                          <Link href={`/dashboard/leads/${l.id}?edit=1`} className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 transition-colors" title="Edit" aria-label="Edit">
                            <Edit2 size={13} />
                          </Link>
                        )}
                        <RoleGuard permission="canDeleteLead">
                          <button
                            onClick={() => handleDelete(l.id)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors"
                            title="Delete"
                            aria-label="Delete"
                          >
                            <Trash2 size={13} />
                          </button>
                        </RoleGuard>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <Link href={`/dashboard/leads/${l.id}`} className="flex items-center gap-3 min-w-[180px]">
                        <Avatar initials={getInitials(l.companyName || l.contactName || '?')} size="sm" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate max-w-[220px]">{l.companyName || l.contactName || '—'}</p>
                          <p className="text-xs text-ink-3 truncate max-w-[220px]">{l.industry || 'Unknown'}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="text-[13px] font-medium text-ink dark:text-slate-200 whitespace-nowrap">{l.contactName || '—'}</p>
                      <p className="text-xs text-ink-3">{l.contactEmail}</p>
                    </td>
                    <RoleGuard permission="canViewAllLeads">
                      <td className="px-4 py-3.5">
                        {l.assignedTo?.name ? (
                          <span className="inline-flex items-center gap-2 text-xs font-medium text-ink dark:text-slate-200 whitespace-nowrap">
                            <span className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-[10px] font-bold flex items-center justify-center">{getInitials(l.assignedTo.name)}</span>
                            {l.assignedTo.name}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-400/10 text-ink-3">Unassigned</span>
                        )}
                      </td>
                    </RoleGuard>
                    <td className="px-4 py-3.5">
                      <ScoreRing score={l.leadScore} size={36} />
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge color={statusColors[l.status] ?? 'gray'}>
                        {formatLabel(l.status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5">
                      {(normalizeLeadType(l.leadType) === 'product' || normalizeLeadType(l.subSource) === 'product') ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-violet-500/10 text-violet-700 dark:text-violet-300"><Package size={11} /> Product</span>
                      ) : (normalizeLeadType(l.leadType) === 'service' || normalizeLeadType(l.subSource) === 'service') ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-500/10 text-blue-700 dark:text-blue-300"><Briefcase size={11} /> Services</span>
                      ) : l.leadType?.trim() ? (
                        // Custom lead type added via admin dropdowns — show it as-is
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-400/10 text-ink-2 whitespace-nowrap"><Tag size={11} /> {l.leadType.trim()}</span>
                      ) : (
                        <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>

                    {/* Lead Created By — the user who created this lead */}
                    <td className="px-4 py-3.5 text-xs font-medium text-ink-2 whitespace-nowrap">
                      {l.createdBy?.name || '—'}
                    </td>

                    {/* Keyword — the platform keyword(s) this lead was discovered for */}
                    <td className="px-4 py-3.5">
                      {l.keyword ? (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 truncate inline-block max-w-[160px] align-middle" title={l.keyword}>
                          {l.keyword}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>

                    {/* Source URL */}
                    <td className="px-4 py-3.5">
                      {(() => {
                        const url = l.sourceUrl || (l.website ? (l.website.startsWith('http') ? l.website : `https://${l.website}`) : '');
                        return url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 max-w-[140px] truncate whitespace-nowrap"
                            title={url}
                          >
                            View Source <ExternalLink size={11} />
                          </a>
                        ) : (
                          <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                        );
                      })()}
                    </td>

                    {/* Origin — Generated (discovery scan) | Imported (CSV) | Manual (form) */}
                    <td className="px-4 py-3.5">
                      {l.scanJobId ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-500/10 text-blue-700 dark:text-blue-300"><Sparkles size={11} /> Generated</span>
                      ) : l.source === 'import' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-400/10 text-ink-2"><FileSpreadsheet size={11} /> Imported</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300"><Hand size={11} /> Manual</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5">
                      {(() => {
                        const info = getFollowUpInfo(l.followUpDate);
                        if (!info) return <span className="text-xs text-slate-300 dark:text-slate-600">—</span>;
                        return (
                          <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border whitespace-nowrap ${info.bg}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${info.dot} ${info.urgency === 'overdue' ? 'animate-pulse' : ''}`} />
                            {info.urgency === 'overdue' ? <Clock size={11} className={info.color} /> : <CalendarDays size={11} className={info.color} />}
                            <span className={info.color}>{info.label}</span>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="card px-4 py-3 flex items-center justify-between text-sm flex-wrap gap-3">
          <span className="inline-flex items-center gap-2 text-ink-3">
            <Users size={14} className="text-blue-600 dark:text-blue-400" />
            <span><span className="font-semibold text-ink tabular-nums">{total}</span> total {total === 1 ? 'lead' : 'leads'}</span>
          </span>
          <Pagination
            page={page}
            totalPages={totalPages}
            pageSize={limit}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setLimit(size); setPage(1); }}
          />
        </div>
      )}

      {/* Assign Leads Modal */}
      {assignOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px] animate-fade-in" onClick={() => setAssignOpen(false)} />
          <div className="relative bg-white dark:bg-surface border border-line rounded-2xl p-6 pt-7 w-full max-w-sm shadow-2xl overflow-hidden animate-fade-in">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-400" />
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30 flex items-center justify-center">
                  <UserCog size={18} />
                </div>
                <div>
                  <h3 className="font-display text-base font-semibold text-ink">Assign Leads</h3>
                  <p className="text-xs text-ink-3 mt-0.5">{selectedLeads.size} lead{selectedLeads.size > 1 ? 's' : ''} selected</p>
                </div>
              </div>
              <button title="Close" onClick={() => setAssignOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/[0.06] transition-colors">
                <X size={16} />
              </button>
            </div>
            <div>
              <label className="label mb-1.5 block">Assign To</label>
              <Select
                title="Select assignee"
                className="input text-sm"
                value={assignToId}
                onChange={e => setAssignToId(e.target.value)}
              >
                <option value="">Select a team member...</option>
                {/* Admin: anyone but themselves. Manager: themselves + their own team only. */}
                {assignableUsers(usersData as any[], user)
                  .filter((u: any) => user?.role === 'manager' || u.id !== user?.id)
                  .map((u: any) => (
                    <option key={u.id} value={u.id}>{u.name} ({u.role?.replace(/_/g, ' ')})</option>
                  ))}
              </Select>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                className="btn-primary flex-1 justify-center py-2.5"
                onClick={() => assignMutation.mutate(assignToId)}
                disabled={!assignToId || assignMutation.isPending}
              >
                {assignMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <UserCog size={14} />}
                Assign
              </button>
              <button className="btn-ghost justify-center py-2.5 px-4" onClick={() => setAssignOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Import Excel Modal */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px] animate-fade-in"
            onClick={() => { setImportOpen(false); setImportFile(null); setImportErrors([]); }}
          />
          <div
            className="relative bg-white dark:bg-surface border border-line rounded-2xl p-6 pt-7 w-full max-w-md shadow-2xl overflow-hidden animate-fade-in"
            onClick={e => e.stopPropagation()}
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 via-green-500 to-teal-400" />
            {/* Header */}
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 text-white shadow-md shadow-emerald-500/30 flex items-center justify-center">
                  <FileSpreadsheet size={18} />
                </div>
                <div>
                  <h3 className="font-display text-base font-semibold text-ink">
                    Import Leads from Excel
                  </h3>
                  <p className="text-xs text-ink-3 mt-0.5">Upload .xlsx or .xls file</p>
                </div>
              </div>
              <button
                type="button"
                title="Close"
                onClick={() => { setImportOpen(false); setImportFile(null); setImportErrors([]); }}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/[0.06] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Download Template */}
            <button
              type="button"
              className="btn-ghost w-full mb-4 justify-center py-2.5"
              onClick={handleDownloadTemplate}
            >
              <Download size={14} /> Download Excel Template
            </button>

            {/* Drag & Drop Zone */}
            <div
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                isDragging
                  ? 'border-blue-400 bg-blue-500/10 scale-[1.01]'
                  : importFile
                  ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10'
                  : 'border-slate-300 dark:border-white/[0.12] hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-500/[0.05]'
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
                  <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30 flex items-center justify-center">
                    <CheckCircle2 size={22} />
                  </div>
                  <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 break-all">{importFile.name}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {(importFile.size / 1024).toFixed(0)} KB
                  </p>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <Upload size={22} />
                  </div>
                  <p className="text-sm font-semibold text-ink">
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
              <div className="mt-3 p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 max-h-36 overflow-y-auto">
                <p className="text-xs font-semibold text-rose-700 dark:text-rose-300 mb-1.5">
                  Import failed — fix these errors:
                </p>
                <ul className="space-y-0.5">
                  {importErrors.map((msg, i) => (
                    <li key={i} className="text-xs text-rose-700 dark:text-rose-300">• {msg}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                className="btn-primary flex-1 justify-center py-2.5"
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
                className="btn-ghost justify-center py-2.5 px-4"
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

      {/* Missing Required Fields Popup */}
      {missingPopup && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center px-4 bg-slate-950/60 backdrop-blur-[2px] animate-fade-in">
          <div className="bg-white dark:bg-surface border border-line rounded-2xl p-6 w-full max-w-2xl shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-md shadow-amber-500/30">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
              </div>
              <div>
                <h3 className="font-display text-[15px] font-semibold text-ink">Missing Required Fields</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {`${missingPopup.rows.length} row${missingPopup.rows.length !== 1 ? 's were' : ' was'} skipped — Lead Type, Contact Name, and Lead Status are required. Fill in the missing values and re-upload.`}
                </p>
              </div>
            </div>

            <div className="mb-4 max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-surface-2 sticky top-0">
                    <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider text-ink-3 font-semibold w-16">Row #</th>
                    <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider text-ink-3 font-semibold">Missing Fields</th>
                  </tr>
                </thead>
                <tbody>
                  {missingPopup.rows.map((r, idx) => (
                    <tr key={idx} className="border-b border-slate-100 dark:border-white/5 last:border-0">
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300 font-mono">{r.row}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.missingFields.map((f, fi) => (
                            <span key={fi} className="inline-block bg-amber-500/10 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded text-[10px] font-medium">
                              {f}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
              Only Lead Type, Contact Name, and Lead Status are required. All other fields are optional.
            </p>
            <button
              className="btn-primary w-full justify-center py-2.5"
              onClick={() => {
                setMissingPopup(null);
                setImportOpen(false);
                setImportFile(null);
                setImportErrors([]);
              }}
            >
              OK, Got It
            </button>
          </div>
        </div>
      )}

      {/* Field Validation Errors Popup */}
      {fieldPopup && !missingPopup && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center px-4 bg-slate-950/60 backdrop-blur-[2px] animate-fade-in">
          <div className="bg-white dark:bg-surface border border-line rounded-2xl p-6 w-full max-w-2xl shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-md shadow-rose-500/30">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="font-display text-[15px] font-semibold text-ink">Invalid Field Values Detected</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {`${new Set(fieldPopup.rows.map((r) => r.row)).size} row${new Set(fieldPopup.rows.map((r) => r.row)).size !== 1 ? 's were' : ' was'} skipped due to invalid values or duplicates. Fix the highlighted cells and re-upload.`}
                </p>
              </div>
            </div>
            <div className="mb-4 max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-surface-2 sticky top-0">
                    <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider text-ink-3 font-semibold">Row #</th>
                    <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider text-ink-3 font-semibold">Field</th>
                    <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider text-ink-3 font-semibold">Invalid Value</th>
                    <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider text-ink-3 font-semibold">Rule</th>
                  </tr>
                </thead>
                <tbody>
                  {fieldPopup.rows.map((r, idx) => (
                    <tr key={idx} className="border-b border-slate-100 dark:border-white/5 last:border-0">
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300 font-mono">{r.row}</td>
                      <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{r.field}</td>
                      <td className="px-3 py-2">
                        <span className="inline-block bg-rose-500/10 text-rose-700 dark:text-rose-300 px-1.5 py-0.5 rounded font-medium max-w-[140px] truncate" title={r.invalidValue}>
                          {r.invalidValue || '(empty)'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-400 dark:text-slate-500 max-w-[200px]">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="btn-primary w-full justify-center py-2.5"
              onClick={() => {
                setFieldPopup(null);
                setImportOpen(false);
                setImportFile(null);
                setImportErrors([]);
              }}
            >
              OK, Got It
            </button>
          </div>
        </div>
      )}

      {/* Invalid Source Popup */}
      {sourcePopup && !missingPopup && !fieldPopup && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center px-4 bg-slate-950/60 backdrop-blur-[2px] animate-fade-in">
          <div className="bg-white dark:bg-surface border border-line rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-md shadow-rose-500/30">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="font-display text-[15px] font-semibold text-ink">Invalid Lead Source Detected</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {`${sourcePopup.count} row${sourcePopup.count !== 1 ? 's were' : ' was'} skipped — the Lead Source value is not in your organisation's source list.`}
                </p>
              </div>
            </div>
            <div className="mb-4 max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-surface-2">
                    <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider text-ink-3 font-semibold">Row #</th>
                    <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider text-ink-3 font-semibold">Invalid Value</th>
                    <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider text-ink-3 font-semibold">Allowed Sources</th>
                  </tr>
                </thead>
                <tbody>
                  {sourcePopup.rows.map((r, idx) => (
                    <tr key={idx} className="border-b border-slate-100 dark:border-white/5 last:border-0">
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300 font-mono">{r.row}</td>
                      <td className="px-3 py-2">
                        <span className="inline-block bg-rose-500/10 text-rose-700 dark:text-rose-300 px-1.5 py-0.5 rounded font-medium">
                          {r.invalidValue || '(empty)'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-400 dark:text-slate-500 truncate max-w-[180px]" title={r.validOptions}>
                        {r.validOptions}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
              Update the Lead Source column in your Excel file to use one of the allowed values above, then re-upload. You can manage allowed sources under <span className="font-semibold">Settings → Lead Source</span>.
            </p>
            <button
              className="btn-primary w-full justify-center py-2.5"
              onClick={() => {
                setSourcePopup(null);
                setImportOpen(false);
                setImportFile(null);
                setImportErrors([]);
              }}
            >
              OK, Got It
            </button>
          </div>
        </div>
      )}

      {/* Invalid Status Popup */}
      {statusPopup && !missingPopup && !fieldPopup && !sourcePopup && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center px-4 bg-slate-950/60 backdrop-blur-[2px] animate-fade-in">
          <div className="bg-white dark:bg-surface border border-line rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-md shadow-rose-500/30">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="font-display text-[15px] font-semibold text-ink">Invalid Lead Status Detected</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {`${statusPopup.count} row${statusPopup.count !== 1 ? 's were' : ' was'} skipped — the Status value is not in your organisation's status list.`}
                </p>
              </div>
            </div>

            <div className="mb-4 max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-surface-2">
                    <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider text-ink-3 font-semibold">Row #</th>
                    <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider text-ink-3 font-semibold">Invalid Value</th>
                    <th className="px-3 py-2.5 text-left text-[11px] uppercase tracking-wider text-ink-3 font-semibold">Allowed Statuses</th>
                  </tr>
                </thead>
                <tbody>
                  {statusPopup.rows.map((r, idx) => (
                    <tr key={idx} className="border-b border-slate-100 dark:border-white/5 last:border-0">
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300 font-mono">{r.row}</td>
                      <td className="px-3 py-2">
                        <span className="inline-block bg-rose-500/10 text-rose-700 dark:text-rose-300 px-1.5 py-0.5 rounded font-medium">
                          {r.invalidValue || '(empty)'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-400 dark:text-slate-500 truncate max-w-[180px]" title={r.validOptions}>
                        {r.validOptions}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
              Update the Status column in your Excel file to use one of the allowed values above, then re-upload. You can manage allowed statuses under <span className="font-semibold">Settings → Lead Status</span>.
            </p>

            <button
              className="btn-primary w-full justify-center py-2.5"
              onClick={() => {
                setStatusPopup(null);
                setImportOpen(false);
                setImportFile(null);
                setImportErrors([]);
              }}
            >
              OK, Got It
            </button>
          </div>
        </div>
      )}
      {/* ── Delete Lead Popup ── */}
      {mounted && deleteConfirm && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-12 pb-6 px-4 bg-slate-950/60 backdrop-blur-[2px] overflow-y-auto animate-fade-in">
          <div className="relative bg-white dark:bg-surface border border-line rounded-2xl p-6 pt-7 w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-rose-500 via-red-500 to-orange-400" />
            <div className="flex flex-col items-center text-center gap-3">
              <div className="relative">
                <div className="absolute inset-0 rounded-2xl bg-rose-500/30 blur-lg" />
                <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/30 flex items-center justify-center">
                  <Trash2 size={22} />
                </div>
              </div>
              <div>
                <h3 className="font-display text-base font-semibold text-ink">Delete Lead</h3>
                <p className="text-sm text-ink-3 mt-1">Are you sure you want to delete this lead? This action cannot be undone.</p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                className="btn-ghost flex-1 justify-center py-2.5"
                onClick={() => setDeleteConfirm(null)}
              >
                No, Cancel
              </button>
              <button
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-sm font-semibold text-white shadow-md shadow-rose-500/25 transition-all disabled:opacity-60"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  deleteMutation.mutate(deleteConfirm);
                  setDeleteConfirm(null);
                }}
              >
                {deleteMutation.isPending ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
}
