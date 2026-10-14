'use client';

import { useState, useEffect, useRef, useId, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leadsApi, opportunitiesApi, usersApi } from '../../../lib/api';
import { normalizeStage, fetchAllPages } from '../../../lib/opportunityPipeline';
import { usePermissions } from '../../../lib/rbac';
import { Avatar } from '../../../components/ui';
import { getInitials } from '../../../lib/utils';
import {
  Plus, Trash2, X, AlertTriangle, Calendar, User,
  Eye, Pencil, Save, Loader2, Briefcase,
  Target, Presentation, FileText, Handshake, Trophy, XCircle,
  Building2, TrendingUp, DollarSign, Inbox, Search, RefreshCw, GripVertical,
  LayoutGrid, List, ChevronUp, ChevronDown, ChevronsUpDown, Check,
} from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { Select } from '../../../components/ui/Select';

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGES = [
  { id: 'qualified',   label: 'Qualified',   color: 'text-blue-600 dark:text-blue-400 bg-blue-500/10' },
  { id: 'demo',        label: 'Demo',        color: 'text-violet-600 dark:text-violet-400 bg-violet-500/10' },
  { id: 'proposal',    label: 'Proposal',    color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10' },
  { id: 'negotiation', label: 'Negotiation', color: 'text-orange-600 dark:text-orange-400 bg-orange-500/10' },
  { id: 'closed_won',  label: 'Closed Won',  color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' },
  { id: 'closed_lost', label: 'Closed Lost', color: 'text-rose-600 dark:text-rose-400 bg-rose-500/10' },
];

// Presentation-only styling per stage (literal classes so Tailwind keeps them)
const STAGE_UI: Record<string, { icon: any; solid: string; bar: string; stripe: string; tint: string; pill: string }> = {
  qualified:   { icon: Target,       solid: 'from-blue-500 to-indigo-600 shadow-blue-500/30',     bar: 'from-blue-500 to-cyan-400',     stripe: 'bg-blue-500',    tint: 'from-blue-50/80 dark:from-blue-500/[0.07]',       pill: 'bg-blue-500/10 text-blue-700 dark:text-blue-300' },
  demo:        { icon: Presentation, solid: 'from-violet-500 to-purple-600 shadow-violet-500/30', bar: 'from-violet-500 to-fuchsia-400', stripe: 'bg-violet-500',  tint: 'from-violet-50/80 dark:from-violet-500/[0.07]',   pill: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' },
  proposal:    { icon: FileText,     solid: 'from-amber-400 to-orange-500 shadow-amber-500/30',   bar: 'from-amber-500 to-yellow-400',  stripe: 'bg-amber-500',   tint: 'from-amber-50/80 dark:from-amber-500/[0.07]',     pill: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  negotiation: { icon: Handshake,    solid: 'from-orange-500 to-red-500 shadow-orange-500/30',    bar: 'from-orange-500 to-amber-400',  stripe: 'bg-orange-500',  tint: 'from-orange-50/80 dark:from-orange-500/[0.07]',   pill: 'bg-orange-500/10 text-orange-700 dark:text-orange-300' },
  closed_won:  { icon: Trophy,       solid: 'from-emerald-500 to-teal-600 shadow-emerald-500/30', bar: 'from-emerald-500 to-teal-400',  stripe: 'bg-emerald-500', tint: 'from-emerald-50/80 dark:from-emerald-500/[0.07]', pill: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  closed_lost: { icon: XCircle,      solid: 'from-rose-500 to-pink-600 shadow-rose-500/30',       bar: 'from-rose-500 to-pink-400',     stripe: 'bg-rose-500',    tint: 'from-rose-50/80 dark:from-rose-500/[0.07]',       pill: 'bg-rose-500/10 text-rose-700 dark:text-rose-300' },
};
const stageUI = (id: string) => STAGE_UI[normalizeStage(id)] ?? STAGE_UI.qualified;

const LOST_CATEGORIES = ['Pricing', 'Competition', 'No Budget', 'Not a Fit', 'Timing', 'Other'];

const STUCK_DAYS_THRESHOLD = 14;

// ── Helpers ───────────────────────────────────────────────────────────────────

const stageColor = (id: string) => STAGES.find(s => s.id === normalizeStage(id))?.color ?? 'text-slate-500 bg-slate-500/10';
const stageLabel = (id: string) => STAGES.find(s => s.id === normalizeStage(id))?.label ?? id;

function daysSince(d?: string | null) {
  if (!d) return 0;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
}
function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtShortDate(d?: string | null) {
  if (!d) return '—';
  const date = new Date(d);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}
function isStuckOpp(opp: any) {
  return daysSince(opp.stageChangedAt || opp.updatedAt) >= STUCK_DAYS_THRESHOLD
    && !['closed_won', 'closed_lost'].includes(opp.stage);
}
const CARD_ICON_BTN = 'w-7 h-7 rounded-lg flex items-center justify-center text-ink-3 hover:text-ink hover:bg-sunken dark:hover:bg-white/[0.06] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40';

// ── Premium accents (theme-aware) ─────────────────────────────────────────────
// Stage accent colours as RGB channels. Blue / violet follow the active theme's palette.
const STAGE_RGB: Record<string, string> = {
  qualified: 'var(--c-primary-500)', demo: 'var(--c-tertiary-500)', proposal: '245 158 11',
  negotiation: '249 115 22', closed_won: '16 185 129', closed_lost: '244 63 94',
};
const stageRgb = (id: string) => STAGE_RGB[normalizeStage(id)] ?? STAGE_RGB.qualified;

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

// ── Won/Lost reason form (card edit + drag to a closed stage) ─────────────────

function WonLostReasonForm({ stage, isPending, onSave, onCancel, dealName }: {
  stage: string; isPending: boolean; onSave: (reason: string) => void; onCancel: () => void; dealName?: string;
}) {
  const isWon = stage === 'closed_won';
  const [reason, setReason]     = useState('');
  const [category, setCategory] = useState('Pricing');
  function save() {
    if (!reason.trim()) { toast.error('Reason is required'); return; }
    onSave(stage === 'closed_lost' ? `[${category}] ${reason.trim()}` : reason.trim());
  }
  return (
    <div className={`rounded-xl border bg-surface p-3.5 space-y-3 shadow-sm animate-fade-in ${isWon ? 'border-emerald-300 dark:border-emerald-500/30' : 'border-rose-300 dark:border-rose-500/30'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isWon ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'}`}>
            {isWon ? <Trophy size={14} /> : <XCircle size={14} />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{isWon ? 'Win Reason' : 'Loss Reason'}</p>
            {dealName && <p className="text-xs text-ink-3 truncate">{dealName}</p>}
          </div>
        </div>
        <button onClick={onCancel} title="Close" aria-label="Close" className={CARD_ICON_BTN}>
          <X size={14} />
        </button>
      </div>
      {!isWon && (
        <div>
          <label className="label mb-1.5 block">Loss Category</label>
          <Select className="input h-9 py-0 text-xs" value={category} onChange={e => setCategory(e.target.value)}>
            {LOST_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
      )}
      <div>
        <label className="label mb-1.5 block">{isWon ? 'Why did we win?' : 'Additional details'} <span className="text-rose-500">*</span></label>
        <textarea className="input min-h-[72px] text-xs resize-none" value={reason} autoFocus
          onChange={e => setReason(e.target.value)}
          placeholder={isWon ? 'e.g. Best price, strong relationship...' : 'e.g. Lost to competitor on pricing...'} />
      </div>
      <div className="flex gap-2">
        <button className="btn-ghost flex-1 h-8 py-0 text-xs justify-center" onClick={onCancel} disabled={isPending}>
          Cancel
        </button>
        <button className={`flex-1 h-8 inline-flex items-center justify-center gap-1.5 text-xs rounded-xl font-semibold text-white shadow-sm transition-colors disabled:opacity-60 ${isWon ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}
          disabled={isPending} onClick={save}>
          {isPending && <Loader2 size={13} className="animate-spin" />}
          Save &amp; Close
        </button>
      </div>
    </div>
  );
}

// ── Opportunity Card ──────────────────────────────────────────────────────────

function OppCard({
  opp, permissions, teamMembers,
  updateMutation, deleteMutation, focused,
  onClose, onDragStart, onDragEnd, isDragging, initialMode,
}: any) {
  const [mode, setMode]           = useState<'view-card' | 'view' | 'edit' | 'delete' | 'reason'>(focused ? 'view' : 'view-card');
  // In the table drawer the card has no compact state: "closing" a panel closes the drawer
  const close = () => (onClose ? onClose() : setMode('view-card'));

  // Opened from a notification: show this deal's details
  useEffect(() => {
    if (focused) setMode('view');
  }, [focused]);

  // Opened from the table with a specific action
  useEffect(() => {
    if (initialMode === 'edit') openEdit();
    else if (initialMode === 'delete') setMode('delete');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [editForm, setEditForm]   = useState<any>({});
  const [editError, setEditError] = useState('');
  const [pendingStage, setPendingStage]   = useState('');

  function openEdit() {
    setEditForm({
      opportunityName:   opp.opportunityName || opp.title || '',
      stage:             normalizeStage(opp.stage),
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
      setMode('reason');
      return;
    }
    const payload: any = {
      opportunityName:   editForm.opportunityName || undefined,
      // An untouched legacy stage is sent back as stored, so saving doesn't register a stage change
      stage:             normalizeStage(newStage) === normalizeStage(opp.stage) ? opp.stage : newStage,
      dealValue:         editForm.dealValue ? Number(editForm.dealValue) : undefined,
      expectedCloseDate: editForm.expectedCloseDate || undefined,
      notes:             editForm.notes || undefined,
    };
    if (!permissions.isSalesUser && editForm.assignedToId) payload.assignedToId = editForm.assignedToId;
    updateMutation.mutate(
      { id: opp.id, data: payload },
      { onSuccess: close, onError: (e: any) => setEditError(e.response?.data?.message || 'Update failed') }
    );
  }

  const colorClass = stageColor(opp.stage);
  const isStuck    = isStuckOpp(opp);

  // ── Delete confirmation ───────────────────────────────────────────────────
  if (mode === 'delete') {
    return (
      <div className="rounded-xl border border-rose-200 dark:border-rose-500/25 bg-surface p-3.5 shadow-sm animate-fade-in">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-rose-500/10 text-rose-600 dark:text-rose-400">
            <Trash2 size={15} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink truncate">
              {opp.opportunityName || opp.title}
            </p>
            <p className="text-xs text-ink-3 mt-0.5 mb-3">Are you sure you want to delete this opportunity?</p>
            <div className="flex gap-2">
              <button className="btn-ghost flex-1 h-8 py-0 text-xs justify-center"
                onClick={() => close()} disabled={deleteMutation.isPending}>
                Cancel
              </button>
              <button
                className="flex-1 h-8 inline-flex items-center justify-center gap-1.5 text-xs rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold shadow-sm transition-colors disabled:opacity-60"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(opp.id, { onSuccess: close })}
              >
                {deleteMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={12} />}
                {deleteMutation.isPending ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Inline Won/Lost reason ────────────────────────────────────────────────
  if (mode === 'reason') {
    return (
      <WonLostReasonForm
        stage={pendingStage}
        isPending={updateMutation.isPending}
        onCancel={close}
        onSave={(reason) => updateMutation.mutate(
          { id: opp.id, data: { stage: pendingStage, wonLostReason: reason } },
          { onSuccess: close }
        )}
      />
    );
  }

  // ── Inline view ───────────────────────────────────────────────────────────
  if (mode === 'view') {
    const ui = stageUI(opp.stage);
    const StageIcon = ui.icon;
    return (
      <div className="rounded-xl border border-line bg-surface overflow-hidden shadow-lg shadow-slate-900/[0.06] dark:shadow-black/30 animate-fade-in">
        <div className="p-3.5 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${ui.pill}`}>
                <StageIcon size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink leading-snug line-clamp-2">
                  {opp.opportunityName || opp.title}
                </p>
                <p className="font-display text-base font-semibold text-ink tabular-nums mt-0.5">{fmtUSD(opp.dealValue)}</p>
              </div>
            </div>
            <button title="Close" aria-label="Close" className={CARD_ICON_BTN} onClick={() => close()}>
              <X size={14} />
            </button>
          </div>

          <dl className="rounded-lg border border-line divide-y divide-line">
            {[
              { label: 'Linked Lead',    value: opp.lead?.companyName },
              { label: 'Contact Person', value: opp.contact?.name || opp.lead?.contactName },
              { label: 'Stage / Status', value: stageLabel(opp.stage) },
              { label: 'Deal Value',     value: fmtUSD(opp.dealValue) },
              { label: 'Expected Close', value: fmtDate(opp.expectedCloseDate) },
              // ASSIGNED TO - HIDDEN (do not remove)
              // { label: 'Assigned To',    value: opp.assignedTo?.name || opp.salesOwner?.name || 'Unassigned' },
              { label: 'Created By',     value: opp.createdBy?.name },
              { label: 'Created Date',   value: fmtDate(opp.createdAt) },
              { label: 'Last Updated',   value: fmtDate(opp.updatedAt) },
            ].map(({ label, value }) => value ? (
              <div key={label} className="flex items-start gap-3 px-3 py-2">
                <dt className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider min-w-[92px] flex-shrink-0 pt-0.5">{label}</dt>
                <dd className="text-xs font-medium text-ink break-words min-w-0">{value}</dd>
              </div>
            ) : null)}
            {opp.wonLostReason && (
              <div className="flex items-start gap-3 px-3 py-2">
                <dt className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider min-w-[92px] flex-shrink-0 pt-0.5">Won/Lost</dt>
                <dd className="text-xs font-medium text-ink break-words min-w-0">{opp.wonLostReason}</dd>
              </div>
            )}
            {opp.notes && (
              <div className="flex items-start gap-3 px-3 py-2">
                <dt className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider min-w-[92px] flex-shrink-0 pt-0.5">Notes</dt>
                <dd className="text-xs text-ink-2 whitespace-pre-wrap break-words min-w-0">{opp.notes}</dd>
              </div>
            )}
          </dl>

          <div className="flex gap-2">
            <button className="btn-ghost flex-1 h-8 py-0 text-xs justify-center" onClick={() => close()}>Close</button>
            <button className="btn-ghost flex-1 h-8 py-0 text-xs justify-center" onClick={openEdit}><Pencil size={12} /> Edit</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Inline edit ───────────────────────────────────────────────────────────
  if (mode === 'edit') {
    return (
      <div className="rounded-xl border border-blue-300 dark:border-blue-500/30 bg-surface p-3.5 space-y-3 shadow-lg shadow-blue-900/[0.06] dark:shadow-black/30 ring-4 ring-blue-500/[0.06] animate-fade-in">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Pencil size={13} />
            </span>
            Edit Opportunity
          </p>
          <button onClick={() => close()} title="Close" aria-label="Close" className={CARD_ICON_BTN}>
            <X size={14} />
          </button>
        </div>

        {/* Name */}
        <div>
          <label className="label mb-1.5 block">Opportunity Name</label>
          <input className="input h-9 py-0 text-xs" value={editForm.opportunityName}
            onChange={e => setEditForm((f: any) => ({ ...f, opportunityName: e.target.value }))} />
        </div>

        {/* Stage */}
        <div>
          <label className="label mb-1.5 block">Stage</label>
          <Select className="input h-9 py-0 text-xs" value={editForm.stage}
            onChange={e => setEditForm((f: any) => ({ ...f, stage: e.target.value }))}>
            {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </div>

        {/* Deal Value + Close Date */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label mb-1.5 block">Deal Value</label>
            <input className="input h-9 py-0 text-xs" type="number" min="0" value={editForm.dealValue}
              onChange={e => setEditForm((f: any) => ({ ...f, dealValue: e.target.value }))} />
          </div>
          <div>
            <label className="label mb-1.5 block">Close Date</label>
            <input className="input h-9 py-0 text-xs" type="date" value={editForm.expectedCloseDate}
              onChange={e => setEditForm((f: any) => ({ ...f, expectedCloseDate: e.target.value }))} />
          </div>
        </div>

        {/* ASSIGNED TO (managers only) - HIDDEN (do not remove)
        {!permissions.isSalesUser && teamMembers.length > 0 && (
          <div>
            <label className="label mb-1.5 block">Assigned To</label>
            <Select className="input h-9 text-xs" value={editForm.assignedToId}
              onChange={e => setEditForm((f: any) => ({ ...f, assignedToId: e.target.value }))}>
              <option value="">— Keep current —</option>
              {teamMembers.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </div>
        )}
        */}

        {/* Notes */}
        <div>
          <label className="label mb-1.5 block">Notes</label>
          <textarea className="input min-h-[56px] text-xs resize-none" value={editForm.notes}
            onChange={e => setEditForm((f: any) => ({ ...f, notes: e.target.value }))}
            placeholder="Add notes..." />
        </div>

        {editError && (
          <p className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400">
            <AlertTriangle size={12} /> {editError}
          </p>
        )}

        <div className="flex gap-2">
          <button className="btn-ghost flex-1 h-8 py-0 text-xs justify-center" onClick={() => close()}
            disabled={updateMutation.isPending}>
            Cancel
          </button>
          <button className="btn-primary flex-1 h-8 py-0 text-xs justify-center" onClick={handleSave}
            disabled={updateMutation.isPending}>
            {updateMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save
          </button>
        </div>
      </div>
    );
  }

  // ── Normal card ───────────────────────────────────────────────────────────
  const ui = stageUI(opp.stage);
  const isClosed = ['closed_won', 'closed_lost'].includes(normalizeStage(opp.stage));
  const closeOverdue = !isClosed && !!opp.expectedCloseDate && toDateInput(opp.expectedCloseDate) < new Date().toISOString().split('T')[0];
  const creator = opp.createdBy?.name || 'Unassigned';
  const contactName = opp.contact?.name || opp.lead?.contactName;
  return (
    <div
      draggable={!!onDragStart}
      onDragStart={(e) => onDragStart?.(e, opp)}
      onDragEnd={onDragEnd}
      className={`group relative rounded-xl border border-line bg-surface p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-white/[0.16] ${onDragStart ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-40 rotate-[0.5deg]' : ''}`}
      style={{ ['--glow' as any]: stageRgb(opp.stage) }}
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity shadow-[0_0_0_1px_rgb(var(--glow)/0.3),0_14px_30px_-16px_rgb(var(--glow)/0.55)]" />
      {/* Top row: name + action icons */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {opp.lead?.id ? (
            <Link href={`/dashboard/leads/${opp.lead.id}`}
              className="text-[13px] font-semibold text-ink hover:text-blue-600 dark:hover:text-blue-400 leading-snug line-clamp-2 transition-colors">
              {opp.opportunityName || opp.title}
            </Link>
          ) : (
            <p className="text-[13px] font-semibold text-ink leading-snug line-clamp-2">
              {opp.opportunityName || opp.title}
            </p>
          )}
          {opp.lead?.companyName && (
            <p className="flex items-center gap-1.5 text-xs text-ink-3 mt-1 min-w-0" title="Linked Lead">
              <Building2 size={12} className="flex-shrink-0" />
              <span className="truncate">{opp.lead.companyName}</span>
            </p>
          )}
          {contactName && (
            <p className="flex items-center gap-1.5 text-xs text-ink-3 mt-0.5 min-w-0" title="Contact Person">
              <User size={12} className="flex-shrink-0" />
              <span className="truncate">{contactName}</span>
            </p>
          )}
        </div>
        <div className="flex items-center flex-shrink-0 -mr-1 -mt-1 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
          <button title="View details" aria-label="View details" className={CARD_ICON_BTN} onClick={() => setMode('view')}>
            <Eye size={14} />
          </button>
          <button title="Edit" aria-label="Edit" className={CARD_ICON_BTN} onClick={openEdit}>
            <Pencil size={13} />
          </button>
          {permissions.canDeleteOpportunities && (
            <button title="Delete" aria-label="Delete"
              className={`${CARD_ICON_BTN} hover:!text-rose-600 hover:!bg-rose-500/10`}
              onClick={() => setMode('delete')}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Value + badges */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className="font-display text-[19px] leading-none font-semibold tracking-[-0.025em] tabular-nums text-ink">
          {fmtUSD(opp.dealValue)}
        </span>
        {isStuck && (
          <span title={`Stuck ${daysSince(opp.stageChangedAt || opp.updatedAt)} days`}
            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300 bg-amber-500/10 ring-1 ring-inset ring-amber-500/20 px-1.5 py-0.5 rounded">
            <AlertTriangle size={10} /> Stuck {daysSince(opp.stageChangedAt || opp.updatedAt)}d
          </span>
        )}
      </div>

      {/* Meta */}
      <div className="mt-3 pt-3 border-t border-line flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 min-w-0" title={`Created by ${creator}`}>
          <Avatar initials={getInitials(creator)} size="xs" />
          <span className="text-ink-2 truncate">{creator}</span>
        </span>
        {opp.expectedCloseDate ? (
          <span
            className={`inline-flex items-center gap-1 flex-shrink-0 tabular-nums ${closeOverdue ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-ink-3'}`}
            title={closeOverdue ? 'Expected close date has passed' : 'Expected close'}
          >
            <Calendar size={12} /> {fmtShortDate(opp.expectedCloseDate)}
          </span>
        ) : (
          <span className="text-ink-3/70 flex-shrink-0">No close date</span>
        )}
      </div>
    </div>
  );
}

// ── Table view ────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'stage' | 'value' | 'probability' | 'close' | 'created';
const STAGE_ORDER_INDEX: Record<string, number> = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));

function sortOpps(rows: any[], key: SortKey, dir: 'asc' | 'desc') {
  const val = (o: any): string | number => {
    switch (key) {
      case 'name':        return (o.opportunityName || o.title || '').toLowerCase();
      case 'stage':       return STAGE_ORDER_INDEX[normalizeStage(o.stage)] ?? 99;
      case 'value':       return Number(o.dealValue || 0);
      case 'probability': return Number(o.probability || 0);
      case 'close':       return o.expectedCloseDate ? toDateInput(o.expectedCloseDate) : '9999-12-31';
      case 'created':     return (o.createdBy?.name || '').toLowerCase();
    }
  };
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    const c = x < y ? -1 : x > y ? 1 : 0;
    return dir === 'asc' ? c : -c;
  });
}

function OppTable({ rows, sortKey, sortDir, onSort, onOpen, canDelete, hasFilters }: {
  rows: any[]; sortKey: SortKey; sortDir: 'asc' | 'desc'; onSort: (k: SortKey) => void;
  onOpen: (id: string, mode: 'view' | 'edit' | 'delete') => void; canDelete: boolean; hasFilters: boolean;
}) {
  const todayKey = new Date().toISOString().split('T')[0];
  const th = (k: SortKey, label: string, className = '') => (
    <th className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3 whitespace-nowrap ${className}`}
      aria-sort={sortKey === k ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 hover:text-ink transition-colors ${sortKey === k ? 'text-ink' : ''}`}>
        {label}
        {sortKey === k
          ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
          : <ChevronsUpDown size={12} className="opacity-40" />}
      </button>
    </th>
  );

  if (rows.length === 0) {
    return (
      <div className={`card flex flex-col items-center justify-center text-center py-16 px-6`}>
        <div className="w-12 h-12 rounded-2xl bg-sunken dark:bg-white/[0.05] text-ink-3 flex items-center justify-center mb-3">
          <Inbox size={20} />
        </div>
        <p className="font-semibold text-ink text-sm">{hasFilters ? 'No matching opportunities' : 'No opportunities yet'}</p>
        <p className="text-xs text-ink-3 mt-1">{hasFilters ? 'Try changing your search or filters.' : 'Create your first deal to start the pipeline.'}</p>
      </div>
    );
  }

  return (
    <div className={`card overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-sunken/50 dark:bg-white/[0.02] border-b border-line text-left">
            <tr>
              {th('name', 'Opportunity', 'pl-5')}
              {th('stage', 'Stage')}
              {th('value', 'Value', 'text-right')}
              {th('probability', 'Probability')}
              {th('close', 'Expected close')}
              {th('created', 'Created by')}
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Health</th>
              <th className="pr-5 pl-3 py-2.5 w-[112px]"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((opp) => {
              const ui = stageUI(opp.stage);
              const StageIcon = ui.icon;
              const closed = ['closed_won', 'closed_lost'].includes(normalizeStage(opp.stage));
              const closeKey = opp.expectedCloseDate ? toDateInput(opp.expectedCloseDate) : '';
              const closeOverdue = !closed && !!closeKey && closeKey < todayKey;
              const prob = Math.max(0, Math.min(100, Number(opp.probability) || 0));
              const creator = opp.createdBy?.name || 'Unassigned';
              const stuck = isStuckOpp(opp);
              return (
                <tr key={opp.id} tabIndex={0}
                  onClick={() => onOpen(opp.id, 'view')}
                  onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(opp.id, 'view'); } }}
                  className="group cursor-pointer hover:bg-sunken/60 dark:hover:bg-white/[0.02] focus-visible:outline-none focus-visible:bg-sunken/60 transition-colors">
                  <td className="pl-5 pr-3 py-3 max-w-[320px]">
                    <p className="font-semibold text-ink truncate" title={opp.opportunityName || opp.title}>{opp.opportunityName || opp.title}</p>
                    {opp.lead?.companyName && (
                      opp.lead?.id ? (
                        <Link href={`/dashboard/leads/${opp.lead.id}`} onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1.5 text-xs text-ink-3 hover:text-blue-600 dark:hover:text-blue-400 mt-0.5 min-w-0 w-fit max-w-full">
                          <Building2 size={11} className="flex-shrink-0" /> <span className="truncate">{opp.lead.companyName}</span>
                        </Link>
                      ) : (
                        <p className="flex items-center gap-1.5 text-xs text-ink-3 mt-0.5"><Building2 size={11} /> {opp.lead.companyName}</p>
                      )
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-md whitespace-nowrap ${ui.pill}`}>
                      <StageIcon size={12} /> {stageLabel(opp.stage)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right font-semibold text-ink tabular-nums whitespace-nowrap">{fmtUSD(opp.dealValue)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-14 h-1.5 rounded-full bg-sunken dark:bg-white/[0.06] overflow-hidden">
                        <div className={`h-full rounded-full ${ui.stripe}`} style={{ width: `${prob}%`, boxShadow: `0 0 8px rgb(${stageRgb(opp.stage)} / 0.8)` }} />
                      </div>
                      <span className="text-xs text-ink-2 tabular-nums">{prob}%</span>
                    </div>
                  </td>
                  <td className={`px-3 py-3 whitespace-nowrap tabular-nums ${closeOverdue ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-ink-2'}`}>
                    {closeKey ? fmtDate(opp.expectedCloseDate) : <span className="text-ink-3">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-2 min-w-0">
                      <Avatar initials={getInitials(creator)} size="xs" />
                      <span className="text-ink-2 truncate max-w-[140px]">{creator}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {stuck ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-500/10 ring-1 ring-inset ring-amber-500/20 px-1.5 py-0.5 rounded">
                        <AlertTriangle size={10} /> Stuck {daysSince(opp.stageChangedAt || opp.updatedAt)}d
                      </span>
                    ) : closeOverdue ? (
                      <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">Close date passed</span>
                    ) : (
                      <span className="text-xs text-ink-3">Updated {fmtShortDate(opp.updatedAt)}</span>
                    )}
                  </td>
                  <td className="pr-5 pl-3 py-3">
                    <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                      <button type="button" title="View details" aria-label="View details" className={CARD_ICON_BTN}
                        onClick={(e) => { e.stopPropagation(); onOpen(opp.id, 'view'); }}><Eye size={14} /></button>
                      <button type="button" title="Edit" aria-label="Edit" className={CARD_ICON_BTN}
                        onClick={(e) => { e.stopPropagation(); onOpen(opp.id, 'edit'); }}><Pencil size={13} /></button>
                      {canDelete && (
                        <button type="button" title="Delete" aria-label="Delete" className={`${CARD_ICON_BTN} hover:!text-rose-600 hover:!bg-rose-500/10`}
                          onClick={(e) => { e.stopPropagation(); onOpen(opp.id, 'delete'); }}><Trash2 size={13} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-3 border-t border-line bg-sunken/40 dark:bg-white/[0.015] flex items-center justify-between text-xs text-ink-3">
        <span>{rows.length} {rows.length === 1 ? 'opportunity' : 'opportunities'}</span>
        <span className="tabular-nums">Total <span className="font-semibold text-ink-2">{fmtUSD(rows.reduce((t, o) => t + Number(o.dealValue || 0), 0))}</span></span>
      </div>
    </div>
  );
}

// ── Lead picker (server-side search, loads more on scroll) ────────────────────

const LEAD_PAGE_SIZE = 50;

function LeadPicker({ selected, onSelect, invalid }: {
  selected: any | null; onSelect: (lead: any | null) => void; invalid?: boolean;
}) {
  const [open, setOpen]         = useState(false);
  const [query, setQuery]       = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage]         = useState(1);
  const [items, setItems]       = useState<any[]>([]);
  const [hasMore, setHasMore]   = useState(false);
  const [active, setActive]     = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId  = useId();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => { setItems([]); setPage(1); setHasMore(false); setActive(-1); }, [debounced]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const { data, isFetching, isError } = useQuery({
    queryKey: ['opp-lead-picker', debounced, page],
    queryFn:  () => leadsApi.list({ ...(debounced ? { search: debounced } : {}), limit: LEAD_PAGE_SIZE, page })
      .then(r => (r.data?.data ?? []) as any[]),
    enabled:  open,
    staleTime: 15_000,
  });
  useEffect(() => {
    if (!Array.isArray(data)) return;
    setItems((prev) => page === 1 ? data : [...prev, ...data.filter((l) => !prev.some((p) => p.id === l.id))]);
    setHasMore(data.length >= LEAD_PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  function choose(lead: any) {
    onSelect(lead);
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { if (open && active >= 0 && items[active]) { e.preventDefault(); choose(items[active]); } }
    else if (e.key === 'Escape') { if (open) { e.stopPropagation(); setOpen(false); } }
  }
  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const showing = open ? query : (selected?.companyName ?? '');

  return (
    <div className="relative" ref={rootRef}>
      <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        className={`input pl-9 pr-9 ${invalid ? '!border-rose-500' : ''} ${selected && !open ? 'font-medium' : ''}`}
        placeholder={selected ? selected.companyName : 'Search leads by company…'}
        value={showing}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      {selected ? (
        <button type="button" aria-label="Clear lead" title="Clear"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center text-ink-3 hover:text-rose-600 hover:bg-rose-500/10 transition-colors"
          onClick={() => { onSelect(null); setQuery(''); }}>
          <X size={13} />
        </button>
      ) : (
        <ChevronDown size={14} className={`absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none transition-transform ${open ? 'rotate-180' : ''}`} />
      )}

      {open && (
        <div
          id={listId}
          ref={listRef}
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1.5 bg-surface border border-line rounded-xl shadow-2xl z-50 max-h-64 overflow-y-auto p-1.5 animate-fade-in"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (hasMore && !isFetching && el.scrollHeight - el.scrollTop <= el.clientHeight + 60) setPage((p) => p + 1);
          }}
        >
          {items.map((l, i) => {
            const isSel = selected?.id === l.id;
            return (
              <button
                key={l.id}
                type="button"
                role="option"
                aria-selected={isSel}
                data-index={i}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(l)}
                className={`w-full flex items-center gap-2.5 text-left px-2.5 py-2 rounded-lg transition-colors ${i === active ? 'bg-blue-50 dark:bg-blue-500/10' : ''}`}
              >
                <span className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
                  <Building2 size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink truncate">{l.companyName}</span>
                  {l.contactName && <span className="block text-[11px] text-ink-3 truncate">{l.contactName}</span>}
                </span>
                {isSel && <Check size={14} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />}
              </button>
            );
          })}
          {isFetching && (
            <p className="flex items-center justify-center gap-2 px-3 py-2.5 text-xs text-ink-3">
              <Loader2 size={13} className="animate-spin" /> {items.length ? 'Loading more…' : 'Searching…'}
            </p>
          )}
          {!isFetching && isError && (
            <p className="px-3 py-3 text-xs text-rose-600 dark:text-rose-400 text-center">Couldn&apos;t load leads. Try again.</p>
          )}
          {!isFetching && !isError && items.length === 0 && (
            <p className="px-3 py-3 text-xs text-ink-3 text-center">
              {debounced ? <>No leads match &ldquo;{debounced}&rdquo;</> : 'No leads available'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OpportunitiesPage() {
  return (
    <Suspense fallback={null}>
      <OpportunitiesBoard />
    </Suspense>
  );
}

function OpportunitiesBoard() {
  const permissions  = usePermissions();
  const queryClient  = useQueryClient();

  // ?focus=<opportunityId> (from a notification) scrolls to and highlights that deal
  const focusParam = useSearchParams().get('focus');
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => { setFocusId(focusParam); }, [focusParam]);

  // Create modal
  const [createOpen,        setCreateOpen]        = useState(false);
  const [createServerError, setCreateServerError] = useState('');

  // Board filters (client-side, over the loaded pipeline)
  const [search,      setSearch]      = useState('');
  const [closeFilter, setCloseFilter] = useState('');
  const [stuckOnly,   setStuckOnly]   = useState(false);

  // Drag & drop between stages
  const [draggingId,    setDraggingId]    = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [pendingMoves,  setPendingMoves]  = useState<Record<string, string>>({}); // optimistic stage per deal
  const [dropReason,    setDropReason]    = useState<{ opp: any; stage: string } | null>(null);

  // Board / table view
  const [viewMode, setViewMode] = useState<'board' | 'table'>('board');
  const [sortKey,  setSortKey]  = useState<SortKey>('stage');
  const [sortDir,  setSortDir]  = useState<'asc' | 'desc'>('asc');
  const [drawer,   setDrawer]   = useState<{ id: string; mode: 'view' | 'edit' | 'delete' } | null>(null);
  const onSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'value' || k === 'probability' ? 'desc' : 'asc'); }
  };

  // Create form (react-hook-form)
  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm({
    defaultValues: defaultCreate,
    resolver: yupResolver(createSchema) as any,
    mode: 'onBlur',
  });
  // Lead chosen in the searchable picker (its contact fills "Contact Person")
  const [selectedLead, setSelectedLead] = useState<any>(null);

  // Body scroll lock when create modal is open
  useEffect(() => {
    document.body.style.overflow = createOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [createOpen]);

  // ── Queries ────────────────────────────────────────────────────────────────

  const queryParams: any = {};
  if (!permissions.canViewAllOpportunities) queryParams.assignedToMe = true;

  // The list endpoint is paginated (default 20), so load every page for the full pipeline
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['opportunities', queryParams],
    queryFn:  () => fetchAllPages<any>((p) => opportunitiesApi.list({ ...queryParams, ...p })),
  });

  const { data: teamData } = useQuery({
    queryKey: ['team-members'],
    queryFn:  () => usersApi.list().then(r => r.data?.data ?? r.data ?? []),
    enabled:  !permissions.isSalesUser,
  });

  const teamMembers = Array.isArray(teamData)  ? teamData  : [];

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
      setSelectedLead(null);
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
  const todayKey = new Date().toISOString().split('T')[0];
  const in30Key  = new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0];
  const query    = search.trim().toLowerCase();
  const filtered = opportunities.filter((o: any) => {
    if (query && ![o.opportunityName, o.title, o.lead?.companyName, o.lead?.contactName, o.contact?.name]
      .some((v) => (v || '').toLowerCase().includes(query))) return false;
    if (stuckOnly && !isStuckOpp(o)) return false;
    if (closeFilter) {
      const key    = o.expectedCloseDate ? toDateInput(o.expectedCloseDate) : '';
      const isOpen = !['closed_won', 'closed_lost'].includes(normalizeStage(o.stage));
      if (closeFilter === 'none' && key) return false;
      if (closeFilter === 'overdue' && !(isOpen && key && key < todayKey)) return false;
      if (closeFilter === 'this_month' && !(key && key.slice(0, 7) === todayKey.slice(0, 7))) return false;
      if (closeFilter === 'next_30' && !(key && key >= todayKey && key <= in30Key)) return false;
    }
    return true;
  });

  const boardStage = (o: any) => pendingMoves[o.id] ?? normalizeStage(o.stage);
  const byStage = STAGES.reduce((acc, s) => {
    acc[s.id] = filtered.filter((o: any) => boardStage(o) === s.id);
    return acc;
  }, {} as Record<string, any[]>);

  // ── Drag & drop ────────────────────────────────────────────────────────────
  function commitMove(opp: any, data: { stage: string; wonLostReason?: string }, onDone?: () => void) {
    const clear = () => setPendingMoves((m) => { const n = { ...m }; delete n[opp.id]; return n; });
    setPendingMoves((m) => ({ ...m, [opp.id]: data.stage }));
    updateMutation.mutate({ id: opp.id, data }, {
      // keep the card in its new column until the refreshed list arrives
      onSuccess: () => { onDone?.(); queryClient.invalidateQueries({ queryKey: ['opportunities'] }).then(clear); },
      onError: clear,
    });
  }
  function moveToStage(oppId: string, stageId: string) {
    const opp = opportunities.find((o: any) => o.id === oppId);
    if (!opp || boardStage(opp) === stageId) return;
    // Closing a deal needs a win/loss reason, same as the edit form
    if (stageId === 'closed_won' || stageId === 'closed_lost') { setDropReason({ opp, stage: stageId }); return; }
    commitMove(opp, { stage: stageId });
  }
  const onCardDragStart = (e: React.DragEvent, opp: any) => {
    e.dataTransfer.setData('text/plain', opp.id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(opp.id);
  };
  const onCardDragEnd = () => { setDraggingId(null); setDragOverStage(null); };
  const draggingFrom = draggingId ? boardStage(opportunities.find((o: any) => o.id === draggingId) ?? {}) : null;

  // Scroll to the deal opened from a notification, then fade the highlight
  useEffect(() => {
    if (!focusId || isLoading) return;
    const el = document.getElementById(`opp-${focusId}`);
    if (!el) return;
    // Bring the stage column on screen, then scroll the column so the deal's top is visible
    const column = el.closest('[id^="col-"]') as HTMLElement | null;
    const list = el.parentElement;
    (column ?? el).scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    if (list) list.scrollTop += el.getBoundingClientRect().top - list.getBoundingClientRect().top - 12;
    const t = setTimeout(() => setFocusId(null), 4000);
    return () => clearTimeout(t);
  }, [focusId, isLoading]);

  // Close the drawer when its deal disappears (deleted) and on Escape
  const drawerOpp = drawer ? opportunities.find((o: any) => o.id === drawer.id) : null;
  useEffect(() => {
    if (drawer && !isLoading && !drawerOpp) setDrawer(null);
  }, [drawer, drawerOpp, isLoading]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
            <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading opportunities">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-slate-200/80 dark:bg-white/[0.06]" />
          <div className="space-y-2">
            <div className="h-3 w-24 rounded bg-slate-200/80 dark:bg-white/[0.06]" />
            <div className="h-5 w-48 rounded bg-slate-200/80 dark:bg-white/[0.06]" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className={`card h-[96px]`} />)}
        </div>
        <div className={`card h-[92px]`} />
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`card p-3 h-[460px] w-[280px] flex-shrink-0 space-y-2.5`}>
              <div className="h-8 rounded-lg bg-slate-200/80 dark:bg-white/[0.05]" />
              <div className="h-28 rounded-xl bg-slate-200/60 dark:bg-white/[0.04]" />
              <div className="h-28 rounded-xl bg-slate-200/60 dark:bg-white/[0.04]" />
            </div>
          ))}
        </div>
      </div>
          );
  }

  if (isError) {
    return (
            <div className={`card flex flex-col items-center justify-center text-center py-20 px-6`}>
        <div className="w-14 h-14 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center mb-4">
          <AlertTriangle size={24} />
        </div>
        <h2 className="font-display font-semibold text-ink mb-1.5">Couldn&apos;t load the pipeline</h2>
        <p className="text-sm text-ink-3 mb-5 max-w-xs">Something went wrong while fetching opportunities. Please try again.</p>
        <button className="btn-ghost text-sm" onClick={() => refetch()}>
          <RefreshCw size={14} /> Retry
        </button>
      </div>
          );
  }

  // Display-only summary figures
  const sumValue = (list: any[]) => list.reduce((t: number, o: any) => t + Number(o.dealValue || 0), 0);
  const weightedValue = (list: any[]) => list.reduce((t: number, o: any) => t + Number(o.dealValue || 0) * (Number(o.probability) || 0) / 100, 0);
  const isClosedStage = (o: any) => ['closed_won', 'closed_lost'].includes(normalizeStage(o.stage));
  const openDeals = opportunities.filter((o: any) => !isClosedStage(o));
  const wonDeals  = opportunities.filter((o: any) => normalizeStage(o.stage) === 'closed_won');
  const lostDeals = opportunities.filter((o: any) => normalizeStage(o.stage) === 'closed_lost');
  const openValue = sumValue(openDeals);
  const wonValue  = sumValue(wonDeals);
  const winRate   = wonDeals.length + lostDeals.length > 0
    ? Math.round((wonDeals.length / (wonDeals.length + lostDeals.length)) * 100)
    : null;
  const stuckCount = opportunities.filter(isStuckOpp).length;

  // Pipeline distribution bar (by value, falling back to count when there are no values)
  const allByStage = STAGES.map((s) => {
    const items = opportunities.filter((o: any) => normalizeStage(o.stage) === s.id);
    return { stage: s, count: items.length, value: sumValue(items) };
  });
  const totalValue = allByStage.reduce((t, x) => t + x.value, 0);
  const totalCount = allByStage.reduce((t, x) => t + x.count, 0);
  const share = (x: { value: number; count: number }) =>
    totalValue > 0 ? x.value / totalValue : totalCount > 0 ? x.count / totalCount : 0;

  const hasFilters = !!(search.trim() || closeFilter || stuckOnly);
  const clearFilters = () => { setSearch(''); setCloseFilter(''); setStuckOnly(false); };
  const scrollToColumn = (id: string) =>
    document.getElementById(`col-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });

  const stats = [
    { label: 'Open pipeline', value: fmtUSD(openValue), sub: `${openDeals.length} open · ${fmtUSD(weightedValue(openDeals))} weighted`, icon: TrendingUp, rgb: 'var(--c-primary-500)' },
    { label: 'Won', value: fmtUSD(wonValue), sub: `${wonDeals.length} deal${wonDeals.length === 1 ? '' : 's'} closed won`, icon: Trophy, rgb: '16 185 129' },
    { label: 'Win rate', value: winRate === null ? '—' : `${winRate}%`, sub: `${wonDeals.length} won · ${lostDeals.length} lost`, icon: Target, rgb: 'var(--c-tertiary-500)' },
    { label: 'Stuck deals', value: String(stuckCount), sub: `No stage change in ${STUCK_DAYS_THRESHOLD}+ days`, icon: AlertTriangle, rgb: '245 158 11', alert: stuckCount > 0 },
  ];

  const closeCreate = () => { setCreateOpen(false); setCreateServerError(''); reset(defaultCreate); setSelectedLead(null); };

  return (
        <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-500/15 flex items-center justify-center flex-shrink-0">
            <Briefcase size={20} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Sales Pipeline</p>
            <h1 className="page-title leading-tight">Opportunities</h1>
            <p className="text-[13px] text-ink-3 mt-0.5">
              {opportunities.length} {opportunities.length === 1 ? 'opportunity' : 'opportunities'} across {STAGES.length} stages
            </p>
          </div>
        </div>
        {permissions.canCreateOpportunities && (
          <button
            className="btn-primary h-10 justify-center whitespace-nowrap flex-shrink-0 self-start sm:self-auto group"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={16} className="transition-transform group-hover:rotate-90" /> New Opportunity
          </button>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className={`card group relative overflow-hidden px-4 py-4 min-w-0 transition-colors hover:border-slate-300 dark:hover:border-white/[0.14]`}>
            <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 w-32 h-32 rounded-full blur-3xl opacity-[0.10] dark:opacity-25 group-hover:opacity-[0.16] dark:group-hover:opacity-35 transition-opacity"
              style={{ background: `rgb(${s.rgb})` }} />
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px"
              style={{ background: `linear-gradient(90deg, transparent, rgb(${s.rgb} / 0.7), transparent)` }} />
            <div className="relative flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-ink-2 truncate">{s.label}</p>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white ring-1 ring-inset ring-white/20 transition-transform duration-200 group-hover:scale-105"
                style={{ background: `linear-gradient(135deg, rgb(${s.rgb}), rgb(${s.rgb} / 0.78))`, boxShadow: `0 8px 18px -8px rgb(${s.rgb} / 0.75)` }}>
                <s.icon size={18} strokeWidth={2.2} />
              </div>
            </div>
            <p className={`relative mt-2 font-display text-[26px] leading-none font-semibold tracking-[-0.035em] tabular-nums truncate ${s.alert ? 'text-amber-600 dark:text-amber-400' : 'text-ink'}`}>
              {s.value}
            </p>
            <p className="relative mt-1.5 text-[11px] text-ink-3 truncate">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Pipeline overview */}
      <section className={`card px-4 sm:px-5 py-4`} aria-label="Pipeline overview">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="section-title">Pipeline overview</h2>
          <span className="text-xs text-ink-2 tabular-nums"><span className="font-semibold text-ink">{fmtUSD(totalValue)}</span> total</span>
        </div>
        <div className="flex h-2.5 w-full rounded-full bg-sunken dark:bg-white/[0.05] gap-[3px]" role="img"
          aria-label={allByStage.map((x) => `${x.stage.label}: ${x.count}`).join(', ')}>
          {allByStage.map((x) => share(x) > 0 && (
            <div key={x.stage.id} className={`${stageUI(x.stage.id).stripe} h-full rounded-full transition-[width] duration-500`}
              style={{ width: `${share(x) * 100}%`, boxShadow: `0 0 14px -1px rgb(${stageRgb(x.stage.id)} / 0.75)` }}
              title={`${x.stage.label}: ${fmtUSD(x.value)} · ${x.count}`} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-2.5">
          {allByStage.map((x) => (
            <button key={x.stage.id} type="button" onClick={() => scrollToColumn(x.stage.id)}
              className="group text-left min-w-0 rounded-lg -m-1.5 p-1.5 hover:bg-sunken/70 dark:hover:bg-white/[0.04] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
              <span className="flex items-center gap-1.5 text-xs text-ink-3 min-w-0">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${stageUI(x.stage.id).stripe}`} style={{ boxShadow: `0 0 8px rgb(${stageRgb(x.stage.id)} / 0.9)` }} />
                <span className="truncate group-hover:text-ink transition-colors">{x.stage.label}</span>
              </span>
              <span className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-sm font-semibold text-ink tabular-nums">{x.count}</span>
                <span className="text-[11px] text-ink-3 tabular-nums truncate">{fmtUSD(x.value)}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center p-0.5 rounded-xl bg-sunken dark:bg-white/[0.04] border border-line" role="tablist" aria-label="View">
          {([
            { value: 'board', label: 'Board', icon: LayoutGrid },
            { value: 'table', label: 'Table', icon: List },
          ] as const).map((v) => (
            <button key={v.value} type="button" role="tab" aria-selected={viewMode === v.value}
              onClick={() => setViewMode(v.value)}
              className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${viewMode === v.value ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-ink-3 hover:text-ink'}`}>
              <v.icon size={14} /> {v.label}
            </button>
          ))}
        </div>
        <div className="relative w-full lg:w-auto lg:flex-1 lg:min-w-[260px] lg:max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
          <input
            className="input pl-9 pr-8 h-10 py-0 text-sm"
            placeholder="Search deal, company or contact…"
            aria-label="Search opportunities"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-sunken"
              onClick={() => setSearch('')}>
              <X size={12} />
            </button>
          )}
        </div>
        <Select className="input h-10 py-0 text-sm w-[calc(50%-4px)] lg:w-48" aria-label="Expected close date"
          value={closeFilter} onChange={(e) => setCloseFilter(e.target.value)}>
          <option value="">All close dates</option>
          <option value="overdue">Close date passed</option>
          <option value="this_month">Closing this month</option>
          <option value="next_30">Closing in 30 days</option>
          <option value="none">No close date</option>
        </Select>
        <button type="button" aria-pressed={stuckOnly} onClick={() => setStuckOnly((v) => !v)}
          className={`h-10 px-3.5 rounded-xl border text-sm font-medium inline-flex items-center justify-center gap-1.5 w-[calc(50%-4px)] lg:w-auto transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${stuckOnly
            ? 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300'
            : 'bg-surface border-line text-ink-2 hover:text-ink hover:border-slate-300 dark:hover:border-white/20'}`}>
          <AlertTriangle size={14} /> Stuck only
          {stuckCount > 0 && <span className="text-[11px] tabular-nums opacity-80">({stuckCount})</span>}
        </button>
        {!hasFilters && opportunities.length > 0 && viewMode === 'board' && (
          <p className="hidden 2xl:flex items-center gap-1.5 ml-auto text-xs text-ink-3">
            <GripVertical size={13} /> Drag cards between stages to update them
          </p>
        )}
        {hasFilters && (
          <div className="flex items-center gap-2 lg:ml-auto">
            <span className="text-xs text-ink-3 tabular-nums">
              Showing <span className="font-semibold text-ink-2">{filtered.length}</span> of {opportunities.length}
            </span>
            <button type="button" onClick={clearFilters}
              className="h-8 px-2 rounded-md text-xs font-semibold text-ink-3 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/[0.06] transition-colors">
              Clear filters
            </button>
          </div>
        )}
      </div>

      {viewMode === 'table' && (
        <OppTable
          rows={sortOpps(filtered, sortKey, sortDir)}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          onOpen={(id, mode) => setDrawer({ id, mode })}
          canDelete={!!permissions.canDeleteOpportunities}
          hasFilters={hasFilters}
        />
      )}

      {/* Kanban — horizontal pipeline */}
      {viewMode === 'board' && (
      <div>
        {/* 3 stages per row on wide screens (2 rows), 2 on tablets, 1 on phones */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {STAGES.map((stage) => {
            const items = byStage[stage.id] || [];
            const ui = stageUI(stage.id);
            const Icon = ui.icon;
            const isClosedCol = stage.id === 'closed_won' || stage.id === 'closed_lost';
            const rgb = stageRgb(stage.id);
            const isOver = dragOverStage === stage.id && draggingFrom !== stage.id;
            const colValue = sumValue(items);
            const colShare = totalValue > 0 ? colValue / totalValue : 0;
            return (
              <div
                key={stage.id}
                id={`col-${stage.id}`}
                onDragOver={(e) => {
                  if (!draggingId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverStage !== stage.id) setDragOverStage(stage.id);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverStage((s) => (s === stage.id ? null : s));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('text/plain') || draggingId;
                  setDragOverStage(null);
                  setDraggingId(null);
                  if (id) moveToStage(id, stage.id);
                }}
                className={`flex flex-col min-w-0 max-h-[560px] rounded-2xl border transition-all duration-200 ${isOver ? 'border-transparent ring-2' : 'border-line bg-sunken/60 dark:bg-white/[0.02]'}`}
                style={isOver ? { ['--tw-ring-color' as any]: `rgb(${rgb} / 0.55)`, background: `rgb(${rgb} / 0.06)` } : undefined}
              >
                {/* Column header */}
                <div className="px-3.5 pt-3.5 pb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: `rgb(${rgb})`, boxShadow: `0 0 0 3px rgb(${rgb} / 0.18)` }} />
                    <h3 className="text-[13px] font-semibold text-ink truncate">{stage.label}</h3>
                    <span className="text-xs font-medium text-ink-3 tabular-nums">{items.length}</span>
                    <Icon size={14} className="ml-auto flex-shrink-0 text-ink-3/70" aria-hidden />
                  </div>
                  <div className="mt-2.5 flex items-baseline justify-between gap-2">
                    <span className="font-display text-[18px] leading-none font-semibold text-ink tabular-nums tracking-[-0.02em]">{fmtUSD(colValue)}</span>
                    {!isClosedCol && items.length > 0 && (
                      <span className="text-[11px] text-ink-3 tabular-nums" title="Deal value × stage probability">
                        {fmtUSD(weightedValue(items))} weighted
                      </span>
                    )}
                  </div>
                  <div className="mt-2.5 h-1 rounded-full bg-line/70 dark:bg-white/[0.06] overflow-hidden" title={`${Math.round(colShare * 100)}% of pipeline value`}>
                    <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(colShare * 100, colValue > 0 ? 3 : 0)}%`, background: `rgb(${rgb})` }} />
                  </div>
                </div>

                {/* Deals */}
                <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                  {items.length === 0 && (
                    draggingId ? (
                      <div className="h-24 flex items-center justify-center rounded-xl border-2 border-dashed text-xs font-medium"
                        style={{ borderColor: `rgb(${rgb} / 0.35)`, color: `rgb(${rgb})` }}>
                        Drop here
                      </div>
                    ) : (
                      <div className="h-full min-h-[120px] flex flex-col items-center justify-center text-center gap-2 py-7">
                        <span className="w-9 h-9 rounded-full bg-surface ring-1 ring-line flex items-center justify-center" style={{ color: `rgb(${rgb})` }}>
                          <Icon size={15} />
                        </span>
                        <p className="text-xs text-ink-3">{hasFilters ? 'No matching deals' : 'No deals yet'}</p>
                      </div>
                    )
                  )}
                  {items.map((opp: any) => (
                    <div
                      key={opp.id}
                      id={`opp-${opp.id}`}
                      className={focusId === opp.id ? 'rounded-xl ring-2 ring-blue-500 ring-offset-2 ring-offset-surface transition-shadow' : undefined}
                    >
                      <OppCard
                        opp={opp}
                        permissions={permissions}
                        teamMembers={teamMembers}
                        updateMutation={updateMutation}
                        deleteMutation={deleteMutation}
                        focused={focusId === opp.id}
                        onDragStart={onCardDragStart}
                        onDragEnd={onCardDragEnd}
                        isDragging={draggingId === opp.id}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* Detail drawer (table view) */}
      {drawer && drawerOpp && (
        <div className="fixed inset-0 z-[9990] flex justify-end bg-slate-950/40 backdrop-blur-[1px] animate-fade-in" onClick={() => setDrawer(null)}
          role="dialog" aria-modal="true" aria-label="Opportunity details">
          <div className="w-full sm:w-[440px] h-full bg-canvas dark:bg-surface border-l border-line shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-line bg-surface">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Opportunity</p>
                <p className="section-title truncate">{drawerOpp.opportunityName || drawerOpp.title}</p>
              </div>
              <button type="button" title="Close" aria-label="Close" className={CARD_ICON_BTN + ' w-8 h-8'} onClick={() => setDrawer(null)}>
                <X size={17} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <OppCard
                key={`${drawer.id}-${drawer.mode}`}
                opp={drawerOpp}
                permissions={permissions}
                teamMembers={teamMembers}
                updateMutation={updateMutation}
                deleteMutation={deleteMutation}
                focused={drawer.mode === 'view'}
                initialMode={drawer.mode}
                onClose={() => setDrawer(null)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Win/loss reason after dropping a deal on a closed stage */}
      {dropReason && (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/50 backdrop-blur-[2px] animate-fade-in"
          role="dialog" aria-modal="true" aria-label={dropReason.stage === 'closed_won' ? 'Win reason' : 'Loss reason'}>
          <div className="w-full sm:max-w-sm">
            <WonLostReasonForm
              stage={dropReason.stage}
              dealName={`${dropReason.opp.opportunityName || dropReason.opp.title} → ${stageLabel(dropReason.stage)}`}
              isPending={updateMutation.isPending}
              onCancel={() => setDropReason(null)}
              onSave={(reason) => commitMove(dropReason.opp, { stage: dropReason.stage, wonLostReason: reason }, () => setDropReason(null))}
            />
          </div>
        </div>
      )}

      {/* ── Create Modal ─────────────────────────────────────────────────────── */}
      {createOpen && (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/50 backdrop-blur-[2px] animate-fade-in"
          role="dialog" aria-modal="true" aria-labelledby="create-opp-title">
          <div className="bg-surface border border-line w-full sm:max-w-2xl shadow-2xl flex flex-col max-h-[92vh] rounded-t-2xl sm:rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-line">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-500/15">
                  <Briefcase size={18} />
                </div>
                <div className="min-w-0">
                  <h3 id="create-opp-title" className="font-display text-base font-semibold text-ink">New Opportunity</h3>
                  <p className="text-xs text-ink-3 truncate">Add a deal to your pipeline</p>
                </div>
              </div>
              <button title="Close" aria-label="Close" className={CARD_ICON_BTN + ' w-8 h-8'} onClick={closeCreate}
                disabled={createMutation.isPending}>
                <X size={17} />
              </button>
            </div>

            <form id="opp-create-form" className="overflow-y-auto flex-1 px-5 sm:px-6 py-5 space-y-6" onSubmit={handleSubmit((values: any) => {
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
              <fieldset className="space-y-4">
                <legend className="flex items-center gap-2 w-full text-[13px] font-semibold text-ink mb-3">
                  Deal details <span className="flex-1 h-px bg-line" aria-hidden="true" />
                </legend>
                {/* Row 1: Linked Lead | Opportunity Name */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="label mb-1.5 block">Linked Lead <span className="text-rose-500">*</span></label>
                    <input type="hidden" {...register('leadId')} />
                    <LeadPicker
                      selected={selectedLead}
                      invalid={!!errors.leadId}
                      onSelect={(lead) => {
                        setSelectedLead(lead);
                        setValue('leadId', lead?.id ?? '', { shouldValidate: true, shouldDirty: true });
                      }}
                    />
                    {errors.leadId && <p className="flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400 mt-1.5"><AlertTriangle size={11} /> {errors.leadId.message as string}</p>}
                  </div>
                  <div>
                    <label className="label mb-1.5 block">Opportunity Name <span className="text-rose-500">*</span></label>
                    <input className={`input ${errors.opportunityName ? '!border-rose-500' : ''}`} placeholder="e.g. Website Proposal – ABC Corp" {...register('opportunityName')} />
                    {errors.opportunityName && <p className="flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400 mt-1.5"><AlertTriangle size={11} /> {errors.opportunityName.message as string}</p>}
                  </div>
                </div>

                {/* Row 2: Stage | Contact Person */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* ASSIGNED TO FIELD - HIDDEN (do not remove)
                  <div>
                    <label className="label mb-1.5 block">Assigned To</label>
                    {permissions.isSalesUser ? (
                      <input className="input bg-slate-50 dark:bg-slate-800 cursor-not-allowed text-slate-500" readOnly value="Assigned to me" />
                    ) : (
                      <Select className="input" {...register('assignedToId')}>
                        <option value="">— Select assignee —</option>
                        {teamMembers.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </Select>
                    )}
                  </div>
                  */}
                  <div>
                    <label className="label mb-1.5 block">Stage / Status</label>
                    <Select className="input" {...register('stage')}>
                      {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="label mb-1.5 block">Contact Person</label>
                    <div className="relative">
                      <User size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 z-10" />
                      <input className="input pl-9 !bg-sunken/60 dark:!bg-white/[0.03] cursor-not-allowed !text-ink-3"
                        readOnly value={contactPersonName || '—'} title="Taken from the linked lead" />
                    </div>
                  </div>
                </div>
              </fieldset>

              <fieldset className="space-y-4">
                <legend className="flex items-center gap-2 w-full text-[13px] font-semibold text-ink mb-3">
                  Value &amp; timeline <span className="flex-1 h-px bg-line" aria-hidden="true" />
                </legend>
                {/* Row 3: Expected Close Date | Deal Value */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="label mb-1.5 block">Expected Close Date</label>
                    <input className="input" type="date" onKeyDown={e => e.preventDefault()} {...register('expectedCloseDate')} />
                  </div>
                  <div>
                    <label className="label mb-1.5 block">Deal Value</label>
                    <div className="relative">
                      <DollarSign size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none z-10" />
                      <input className="input pl-9 tabular-nums" type="number" min="0" placeholder="0" {...register('dealValue')} />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="label mb-1.5 block">Notes / Comments</label>
                  <textarea className="input min-h-[80px] resize-y leading-relaxed" placeholder="Add notes..." {...register('notes')} />
                </div>
              </fieldset>

              {createServerError && (
                <p className="flex items-center gap-2 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-lg px-3 py-2">
                  <AlertTriangle size={13} /> {createServerError}
                </p>
              )}
            </form>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 px-5 sm:px-6 py-4 border-t border-line bg-sunken/50 dark:bg-white/[0.02]">
              <p className="hidden sm:block text-[11px] text-ink-3"><span className="text-rose-500">*</span> Required fields</p>
              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <button type="button" className="btn-ghost justify-center py-2.5 sm:min-w-[110px]" onClick={closeCreate}
                  disabled={createMutation.isPending}>
                  Cancel
                </button>
                <button type="submit" form="opp-create-form" className="btn-primary justify-center py-2.5 sm:min-w-[170px]" disabled={createMutation.isPending}>
                  {createMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  {createMutation.isPending ? 'Creating…' : 'Create opportunity'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
      );
}
