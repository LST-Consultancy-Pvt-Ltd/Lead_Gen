'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leadsApi, opportunitiesApi, usersApi } from '../../../lib/api';
import { usePermissions } from '../../../lib/rbac';
import { Spinner } from '../../../components/ui';
import {
  Plus, Trash2, X, AlertTriangle, Calendar, User,
  Eye, Pencil, Save, Loader2, Briefcase,
} from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { useForm, useWatch } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGES = [
  { id: 'qualified',   label: 'Qualified',   color: 'text-blue-400 bg-blue-500/10' },
  { id: 'demo',        label: 'Demo',        color: 'text-violet-400 bg-violet-500/10' },
  { id: 'proposal',    label: 'Proposal',    color: 'text-amber-400 bg-amber-500/10' },
  { id: 'negotiation', label: 'Negotiation', color: 'text-orange-400 bg-orange-500/10' },
  { id: 'closed_won',  label: 'Closed Won',  color: 'text-emerald-400 bg-emerald-500/10' },
  { id: 'closed_lost', label: 'Closed Lost', color: 'text-red-400 bg-red-500/10' },
];

const LOST_CATEGORIES = ['Pricing', 'Competition', 'No Budget', 'Not a Fit', 'Timing', 'Other'];

const STUCK_DAYS_THRESHOLD = 14;

// ── Helpers ───────────────────────────────────────────────────────────────────

const stageColor = (id: string) => STAGES.find(s => s.id === id)?.color ?? 'text-slate-400 bg-slate-500/10';
const stageLabel = (id: string) => STAGES.find(s => s.id === id)?.label ?? id;

function daysSince(d?: string | null) {
  if (!d) return 0;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
}
function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtUSD(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(v || 0));
}
function toDateInput(d?: string | null) {
  if (!d) return '';
  return new Date(d).toISOString().split('T')[0];
}

// ── Create schema ─────────────────────────────────────────────────────────────

const createSchema = yup.object({
  opportunityName:   yup.string().trim().required('Opportunity Name is required'),
  stage:             yup.mixed<string>().oneOf(STAGES.map(s => s.id)).optional(),
  dealValue:         yup.string().optional(),
  expectedCloseDate: yup.string().optional(),
  leadId:            yup.string().required('Please select a lead'),
  assignedToId:      yup.string().optional(),
  notes:             yup.string().optional(),
});

const defaultCreate = { opportunityName: '', stage: 'qualified', dealValue: '', expectedCloseDate: '', leadId: '', assignedToId: '', notes: '' };

// ── Opportunity Card ──────────────────────────────────────────────────────────

function OppCard({
  opp, permissions, teamMembers,
  updateMutation, deleteMutation,
}: any) {
  const [mode, setMode]           = useState<'view-card' | 'view' | 'edit' | 'delete' | 'reason'>('view-card');
  const [editForm, setEditForm]   = useState<any>({});
  const [editError, setEditError] = useState('');
  const [pendingStage, setPendingStage]   = useState('');
  const [wonLostReason, setWonLostReason] = useState('');
  const [lostCategory, setLostCategory]  = useState('Pricing');

  function openEdit() {
    setEditForm({
      opportunityName:   opp.opportunityName || opp.title || '',
      stage:             opp.stage           || 'qualified',
      dealValue:         opp.dealValue       ?? 0,
      expectedCloseDate: toDateInput(opp.expectedCloseDate),
      assignedToId:      opp.assignedToId    || '',
      notes:             opp.notes           || '',
    });
    setEditError('');
    setMode('edit');
  }

  function handleSave() {
    setEditError('');
    const newStage = editForm.stage;
    if (newStage !== opp.stage && (newStage === 'closed_won' || newStage === 'closed_lost')) {
      setPendingStage(newStage);
      setWonLostReason('');
      setLostCategory('Pricing');
      setMode('reason');
      return;
    }
    const payload: any = {
      opportunityName:   editForm.opportunityName || undefined,
      stage:             newStage,
      dealValue:         editForm.dealValue ? Number(editForm.dealValue) : undefined,
      expectedCloseDate: editForm.expectedCloseDate || undefined,
      notes:             editForm.notes || undefined,
    };
    if (!permissions.isSalesUser && editForm.assignedToId) payload.assignedToId = editForm.assignedToId;
    updateMutation.mutate(
      { id: opp.id, data: payload },
      { onSuccess: () => setMode('view-card'), onError: (e: any) => setEditError(e.response?.data?.message || 'Update failed') }
    );
  }

  function handleReasonSave() {
    if (!wonLostReason.trim()) { toast.error('Reason is required'); return; }
    const reason = pendingStage === 'closed_lost'
      ? `[${lostCategory}] ${wonLostReason.trim()}`
      : wonLostReason.trim();
    updateMutation.mutate(
      { id: opp.id, data: { stage: pendingStage, wonLostReason: reason } },
      { onSuccess: () => setMode('view-card') }
    );
  }

  const colorClass = stageColor(opp.stage);
  const isStuck    = daysSince(opp.stageChangedAt || opp.updatedAt) >= STUCK_DAYS_THRESHOLD
                     && !['closed_won','closed_lost'].includes(opp.stage);

  // ── Delete confirmation ───────────────────────────────────────────────────
  if (mode === 'delete') {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/[0.04] p-3">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
            <Briefcase size={15} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate mb-1">
              {opp.opportunityName || opp.title}
            </p>
            <p className="text-xs text-slate-500 mb-3">Are you sure you want to delete this opportunity?</p>
            <div className="flex gap-2">
              <button
                className="flex-1 h-8 text-xs rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold transition-colors disabled:opacity-60"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(opp.id, { onSuccess: () => setMode('view-card') })}
              >
                {deleteMutation.isPending ? <Loader2 size={12} className="animate-spin mx-auto" /> : 'Yes, Delete'}
              </button>
              <button className="flex-1 h-8 text-xs rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                onClick={() => setMode('view-card')}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Inline Won/Lost reason ────────────────────────────────────────────────
  if (mode === 'reason') {
    const isWon = pendingStage === 'closed_won';
    return (
      <div className={`rounded-xl border p-3 space-y-3 ${isWon ? 'border-emerald-500/30 bg-emerald-500/[0.04]' : 'border-red-500/30 bg-red-500/[0.04]'}`}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            {isWon ? '🏆 Win Reason' : '❌ Loss Reason'}
          </p>
          <button onClick={() => setMode('view-card')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X size={14} />
          </button>
        </div>
        {!isWon && (
          <div>
            <label className="label text-xs">Loss Category</label>
            <select className="input h-9 text-xs" value={lostCategory} onChange={e => setLostCategory(e.target.value)}>
              {LOST_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label text-xs">{isWon ? 'Why did we win?' : 'Additional details'}</label>
          <textarea className="input min-h-[72px] text-xs resize-none" value={wonLostReason}
            onChange={e => setWonLostReason(e.target.value)}
            placeholder={isWon ? 'e.g. Best price, strong relationship...' : 'e.g. Lost to competitor on pricing...'} />
        </div>
        <div className="flex gap-2">
          <button className={`flex-1 h-9 text-xs rounded-xl font-semibold text-white transition-colors disabled:opacity-60 ${isWon ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-red-500 hover:bg-red-600'}`}
            disabled={updateMutation.isPending} onClick={handleReasonSave}>
            {updateMutation.isPending ? <Loader2 size={12} className="animate-spin mx-auto" /> : 'Save & Close'}
          </button>
          <button className="flex-1 h-9 text-xs rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            onClick={() => setMode('view-card')}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Inline view ───────────────────────────────────────────────────────────
  if (mode === 'view') {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-950 p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
              <Briefcase size={14} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate leading-tight">
                {opp.opportunityName || opp.title}
              </p>
            </div>
          </div>
          <button className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors flex-shrink-0"
            onClick={() => setMode('view-card')}>
            <X size={14} />
          </button>
        </div>

        {/* Details grid */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-3 space-y-2 border border-slate-200 dark:border-white/[0.06]">
          {[
            { label: 'Linked Lead',    value: opp.lead?.companyName },
            { label: 'Contact Person', value: opp.contact?.name || opp.lead?.contactName },
            { label: 'Stage / Status', value: stageLabel(opp.stage) },
            { label: 'Deal Value',     value: fmtUSD(opp.dealValue) },
            { label: 'Expected Close', value: fmtDate(opp.expectedCloseDate) },
            { label: 'Assigned To',    value: opp.assignedTo?.name || opp.salesOwner?.name || 'Unassigned' },
            { label: 'Created By',     value: opp.createdBy?.name },
            { label: 'Created Date',   value: fmtDate(opp.createdAt) },
            { label: 'Last Updated',   value: fmtDate(opp.updatedAt) },
          ].map(({ label, value }) => value ? (
            <div key={label} className="flex items-start gap-2">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider min-w-[88px] flex-shrink-0 pt-px">{label}</span>
              <span className="text-xs text-slate-700 dark:text-slate-300">{value}</span>
            </div>
          ) : null)}
          {opp.wonLostReason && (
            <div className="flex items-start gap-2 pt-1 border-t border-slate-200 dark:border-white/[0.06]">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider min-w-[88px] flex-shrink-0 pt-px">Won/Lost</span>
              <span className="text-xs text-slate-700 dark:text-slate-300">{opp.wonLostReason}</span>
            </div>
          )}
          {opp.notes && (
            <div className="flex items-start gap-2">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider min-w-[88px] flex-shrink-0 pt-px">Notes</span>
              <span className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{opp.notes}</span>
            </div>
          )}
        </div>

        <button className="btn-ghost w-full h-8 text-xs" onClick={() => setMode('view-card')}>Close</button>
      </div>
    );
  }

  // ── Inline edit ───────────────────────────────────────────────────────────
  if (mode === 'edit') {
    return (
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.03] p-3 space-y-3">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Edit Opportunity</p>
          <button onClick={() => setMode('view-card')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X size={14} />
          </button>
        </div>

        {/* Name */}
        <div>
          <label className="label text-xs">Opportunity Name</label>
          <input className="input h-9 text-xs" value={editForm.opportunityName}
            onChange={e => setEditForm((f: any) => ({ ...f, opportunityName: e.target.value }))} />
        </div>

        {/* Stage */}
        <div>
          <label className="label text-xs">Stage</label>
          <select className="input h-9 text-xs" value={editForm.stage}
            onChange={e => setEditForm((f: any) => ({ ...f, stage: e.target.value }))}>
            {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>

        {/* Deal Value + Close Date */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label text-xs">Deal Value</label>
            <input className="input h-9 text-xs" type="number" min="0" value={editForm.dealValue}
              onChange={e => setEditForm((f: any) => ({ ...f, dealValue: e.target.value }))} />
          </div>
          <div>
            <label className="label text-xs">Close Date</label>
            <input className="input h-9 text-xs" type="date" value={editForm.expectedCloseDate}
              onChange={e => setEditForm((f: any) => ({ ...f, expectedCloseDate: e.target.value }))} />
          </div>
        </div>

        {/* Assigned To (managers only) */}
        {!permissions.isSalesUser && teamMembers.length > 0 && (
          <div>
            <label className="label text-xs">Assigned To</label>
            <select className="input h-9 text-xs" value={editForm.assignedToId}
              onChange={e => setEditForm((f: any) => ({ ...f, assignedToId: e.target.value }))}>
              <option value="">— Keep current —</option>
              {teamMembers.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="label text-xs">Notes</label>
          <textarea className="input min-h-[56px] text-xs resize-none" value={editForm.notes}
            onChange={e => setEditForm((f: any) => ({ ...f, notes: e.target.value }))}
            placeholder="Add notes..." />
        </div>

        {editError && <p className="text-xs text-red-400">{editError}</p>}

        <div className="flex gap-2">
          <button className="btn-primary flex-1 h-9 text-xs" onClick={handleSave}
            disabled={updateMutation.isPending}>
            {updateMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save
          </button>
          <button className="btn-ghost flex-1 h-9 text-xs" onClick={() => setMode('view-card')}
            disabled={updateMutation.isPending}>
            <X size={13} /> Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Normal card ───────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-950 p-3">
      {/* Top row: icon + name + action icons */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-start gap-2 min-w-0">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
            <Briefcase size={14} />
          </div>
          <div className="min-w-0">
            {opp.lead?.id ? (
              <Link href={`/dashboard/leads/${opp.lead.id}`}
                className="text-sm font-semibold text-slate-800 dark:text-slate-200 hover:text-blue-500 dark:hover:text-blue-400 leading-tight truncate block transition-colors">
                {opp.opportunityName || opp.title}
              </Link>
            ) : (
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 leading-tight truncate">
                {opp.opportunityName || opp.title}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
          {isStuck && (
            <span title={`Stuck ${daysSince(opp.stageChangedAt || opp.updatedAt)} days`}
              className="flex items-center gap-0.5 text-[10px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/25 px-1.5 py-0.5 rounded-full mr-1">
              <AlertTriangle size={8} /> Stuck
            </span>
          )}
          <button title="View details"
            className="p-1 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-500/10 transition-colors"
            onClick={() => setMode('view')}>
            <Eye size={12} />
          </button>
          <button title="Edit"
            className="p-1 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-500/10 transition-colors"
            onClick={openEdit}>
            <Pencil size={12} />
          </button>
          {permissions.canDeleteOpportunities && (
            <button title="Delete"
              className="p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-colors"
              onClick={() => setMode('delete')}>
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Info rows */}
      <div className="mt-2 space-y-1.5">
        {opp.lead?.companyName && (
          <div className="flex gap-2">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider min-w-[56px] flex-shrink-0 pt-px">Linked Lead : </span>
            <span className="text-xs text-slate-700 dark:text-slate-300 truncate">{opp.lead.companyName}</span>
          </div>
        )}
        {(opp.contact?.name || opp.lead?.contactName) && (
          <div className="flex gap-2">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider min-w-[56px] flex-shrink-0 pt-px">Contact Person: </span>
            <span className="text-xs text-slate-700 dark:text-slate-300 flex items-center gap-1 truncate">
              <User size={9} className="flex-shrink-0" />
              {opp.contact?.name || opp.lead?.contactName}
            </span>
          </div>
        )}
        {opp.expectedCloseDate && (
          <div className="flex gap-2">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider min-w-[56px] flex-shrink-0 pt-px">Close</span>
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <Calendar size={9} className="flex-shrink-0" />
              {fmtDate(opp.expectedCloseDate)}
            </span>
          </div>
        )}
        <div className="flex gap-2">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider min-w-[56px] flex-shrink-0 pt-px">Stage: </span>
          <span className="text-xs text-slate-700 dark:text-slate-300">{stageLabel(opp.stage)}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider min-w-[56px] flex-shrink-0 pt-px">Created By: </span>
          <span className="text-xs text-slate-500">{opp.createdBy?.name || 'Unassigned'}</span>
        </div>
        {/* {opp.createdBy?.name && (
          <div className="flex gap-2 pt-1 border-t border-slate-200 dark:border-white/[0.06] mt-1">
            <span className="text-[10px] text-slate-400 min-w-[56px] flex-shrink-0 pt-px">By</span>
            <span className="text-xs text-slate-400">{opp.createdBy.name} · {fmtDate(opp.createdAt)}</span>
          </div>
        )} */}
      </div>

    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OpportunitiesPage() {
  const permissions  = usePermissions();
  const queryClient  = useQueryClient();

  // Create modal
  const [createOpen,        setCreateOpen]        = useState(false);
  const [createServerError, setCreateServerError] = useState('');

  // Create form (react-hook-form)
  const { register, handleSubmit, reset, control, formState: { errors } } = useForm({
    defaultValues: defaultCreate,
    resolver: yupResolver(createSchema) as any,
    mode: 'onBlur',
  });
  const watchedLeadId = useWatch({ control, name: 'leadId' });

  // Body scroll lock when create modal is open
  useEffect(() => {
    document.body.style.overflow = createOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [createOpen]);

  // ── Queries ────────────────────────────────────────────────────────────────

  const queryParams: any = {};
  if (!permissions.canViewAllOpportunities) queryParams.assignedToMe = true;

  const { data, isLoading } = useQuery({
    queryKey: ['opportunities', queryParams],
    queryFn:  () => opportunitiesApi.list(queryParams).then(r => r.data.data),
  });

  const { data: leadsData } = useQuery({
    queryKey: ['all-leads-dropdown'],
    queryFn:  () => leadsApi.list({ limit: 100 }).then(r => r.data?.data ?? []),
  });

  const { data: teamData } = useQuery({
    queryKey: ['team-members'],
    queryFn:  () => usersApi.list().then(r => r.data?.data ?? r.data ?? []),
    enabled:  !permissions.isSalesUser,
  });

  const leads       = Array.isArray(leadsData) ? leadsData : [];
  const teamMembers = Array.isArray(teamData)  ? teamData  : [];

  const selectedLead      = leads.find((l: any) => l.id === watchedLeadId);
  const contactPersonName = selectedLead?.contactName || '';

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (payload: any) => opportunitiesApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Opportunity created');
      setCreateOpen(false);
      setCreateServerError('');
      reset(defaultCreate);
    },
    onError: (error: any) => {
      const msg = error.response?.data?.message || 'Failed to create opportunity';
      setCreateServerError(msg);
      toast.error(msg);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => opportunitiesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Opportunity updated');
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Failed to update'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => opportunitiesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Opportunity deleted');
    },
    onError: () => toast.error('Failed to delete opportunity'),
  });

  // ── Derived data ───────────────────────────────────────────────────────────

  const opportunities = (data as any[]) ?? [];
  const filtered = opportunities;

  const byStage = STAGES.reduce((acc, s) => {
    acc[s.id] = filtered.filter((o: any) => o.stage === s.id);
    return acc;
  }, {} as Record<string, any[]>);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) return <div className="flex items-center justify-center h-64"><Spinner size={24} /></div>;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Opportunities Pipeline</h1>
          <p className="text-sm text-slate-500 mt-1">{filtered.length} opportunities</p>
        </div>
        {permissions.canCreateOpportunities && (
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} /> New Opportunity
          </button>
        )}
      </div>

      {/* Kanban — 3 columns per row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {STAGES.map((stage) => {
          const items = byStage[stage.id] || [];
          return (
            <div key={stage.id} className="card p-3 flex flex-col h-[520px]">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{stage.label}</h3>
                <span className="text-xs bg-slate-200 dark:bg-slate-800 text-slate-500 rounded-full px-2 py-0.5 font-medium">
                  {items.length}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-3 pr-0.5">
                {items.length === 0 && (
                  <p className="text-xs text-slate-500 text-center mt-8">No opportunities</p>
                )}
                {items.map((opp: any) => (
                  <OppCard
                    key={opp.id}
                    opp={opp}
                    permissions={permissions}
                    teamMembers={teamMembers}
                    updateMutation={updateMutation}
                    deleteMutation={deleteMutation}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Create Modal ─────────────────────────────────────────────────────── */}
      {createOpen && (
        <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-12 pb-6 px-4 bg-black/60 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="section-title">New Opportunity</h3>
              <button onClick={() => { setCreateOpen(false); setCreateServerError(''); reset(defaultCreate); }}>
                <X size={16} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" />
              </button>
            </div>
            <form className="space-y-3" onSubmit={handleSubmit((values: any) => {
              setCreateServerError('');
              createMutation.mutate({
                opportunityName:   values.opportunityName || undefined,
                stage:             values.stage,
                dealValue:         values.dealValue ? Number(values.dealValue) : undefined,
                expectedCloseDate: values.expectedCloseDate || undefined,
                leadId:            values.leadId || undefined,
                assignedToId:      values.assignedToId || undefined,
                notes:             values.notes || undefined,
              });
            })}>
              {/* Row 1: Linked Lead | Opportunity Name */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1 block">Linked Lead <span className="text-red-400">*</span></label>
                  <select className={`input ${errors.leadId ? 'border-red-500' : ''}`} {...register('leadId')}>
                    <option value="">Select a lead</option>
                    {leads.map((l: any) => <option key={l.id} value={l.id}>{l.companyName}</option>)}
                  </select>
                  {errors.leadId && <p className="text-xs text-red-400 mt-1">{errors.leadId.message as string}</p>}
                </div>
                <div>
                  <label className="label mb-1 block">Opportunity Name <span className="text-red-400">*</span></label>
                  <input className={`input ${errors.opportunityName ? 'border-red-500' : ''}`} placeholder="e.g. Website Proposal – ABC Corp" {...register('opportunityName')} />
                  {errors.opportunityName && <p className="text-xs text-red-400 mt-1">{errors.opportunityName.message as string}</p>}
                </div>
              </div>

              {/* Row 2: Assigned To | Contact Person */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1 block">Assigned To</label>
                  {permissions.isSalesUser ? (
                    <input className="input bg-slate-50 dark:bg-slate-800 cursor-not-allowed text-slate-500" readOnly value="Assigned to me" />
                  ) : (
                    <select className="input" {...register('assignedToId')}>
                      <option value="">— Select assignee —</option>
                      {teamMembers.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label className="label mb-1 block">Contact Person</label>
                  <input className="input bg-slate-50 dark:bg-slate-800 cursor-not-allowed text-slate-500"
                    readOnly value={contactPersonName || '—'} />
                </div>
              </div>

              {/* Row 3: Stage | Expected Close Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1 block">Stage / Status</label>
                  <select className="input" {...register('stage')}>
                    {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label mb-1 block">Expected Close Date</label>
                  <input className="input" type="date" onKeyDown={e => e.preventDefault()} {...register('expectedCloseDate')} />
                </div>
              </div>

              {/* Row 4: Deal Value | Notes */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1 block">Deal Value</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium pointer-events-none">$</span>
                    <input className="input pl-7" type="number" min="0" placeholder="0" {...register('dealValue')} />
                  </div>
                </div>
                <div />
              </div>
              <div>
                <label className="label mb-1 block">Notes / Comments</label>
                <textarea className="input min-h-[70px] resize-none" placeholder="Add notes..." {...register('notes')} />
              </div>
              {createServerError && <p className="text-xs text-red-400">{createServerError}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" className="btn-ghost flex-1"
                  onClick={() => { setCreateOpen(false); setCreateServerError(''); reset(defaultCreate); }}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex-1" disabled={createMutation.isPending}>
                  {createMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
