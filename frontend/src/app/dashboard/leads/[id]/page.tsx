'use client';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leadsApi } from '../../../../lib/api';
import { Badge, Avatar, ScoreRing, Spinner } from '../../../../components/ui';
import { ActivitiesList } from '../../../../components/crm/ActivitiesList';
import { RoleGuard } from '../../../../components/common/RoleGuard';
import { usePermissions } from '../../../../lib/rbac';
import { useAuthStore } from '../../../../store/authStore';
import { getInitials, intentColors, statusColors } from '../../../../lib/utils';
import {
  ArrowLeft, Zap, Send, Loader2, RefreshCw, Globe, Mail,
  User, Linkedin, Search, CheckCircle2, XCircle, Building2,
  MapPin, Users2, FileText, Phone, ExternalLink, Copy,
  ChevronRight, Shield, Trash2, UserCog, Calendar, DollarSign,
  Clock, TrendingUp, Edit2, Save, X,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

function cn(...cls: (string | boolean | undefined | null)[]) {
  return cls.filter(Boolean).join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type EnrichState =
  | { status: 'idle' }
  | { status: 'searching_sh' }
  | { status: 'sh_found'; source: 'signalhire' }
  | { status: 'sh_not_found' }
  | { status: 'searching_apollo' }
  | { status: 'apollo_found'; source: 'apollo' }
  | { status: 'both_failed' };

// ─────────────────────────────────────────────────────────────────────────────
// Info row
// ─────────────────────────────────────────────────────────────────────────────

function InfoRow({
  icon, label, value, href, copyable,
}: {
  icon: React.ReactNode; label: string; value?: string | null;
  href?: string; copyable?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-3 p-3 bg-slate-950 rounded-xl group">
      <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">{label}</p>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer"
            className="text-sm text-blue-400 hover:underline truncate block">{value}</a>
        ) : (
          <p className="text-sm text-slate-200 truncate">{value}</p>
        )}
      </div>
      {copyable && (
        <button className="opacity-0 group-hover:opacity-100 transition-opacity btn-ghost text-[10px] py-1 px-2 flex-shrink-0"
          title={`Copy ${label}`}
          onClick={() => { navigator.clipboard.writeText(value!); toast.success('Copied!'); }}>
          <Copy size={10} />
        </button>
      )}
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" title={`Open ${label}`}
          className="opacity-0 group-hover:opacity-100 transition-opacity btn-ghost text-[10px] py-1 px-2 flex-shrink-0">
          <ExternalLink size={10} />
        </a>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EnrichPanel
// ─────────────────────────────────────────────────────────────────────────────

function EnrichPanel({
  enrichState, onSignalHire, onApollo, hasContact,
}: {
  enrichState: EnrichState; onSignalHire: () => void; onApollo: () => void; hasContact: boolean;
}) {
  const { status } = enrichState;
  const isSHLoading     = status === 'searching_sh';
  const isApolloLoading = status === 'searching_apollo';

  if (hasContact && status === 'idle') {
    return (
      <div className="flex gap-2 pt-3 border-t border-white/[0.05] mt-3">
        <button className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
          onClick={onSignalHire} disabled={isSHLoading}>
          {isSHLoading ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
          Re-search SignalHire
        </button>
        <button className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-violet-500/10 border border-violet-500/25 text-violet-400 hover:bg-violet-500/20 transition-colors"
          onClick={onApollo} disabled={isApolloLoading}>
          {isApolloLoading ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
          Re-search Apollo
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-3">
      {/* SignalHire button */}
      <div className={cn(
        'rounded-xl border p-3.5 transition-all',
        isSHLoading ? 'bg-emerald-500/[0.08] border-emerald-500/30'
          : status === 'sh_found' ? 'bg-emerald-500/[0.08] border-emerald-500/30'
          : status === 'sh_not_found' || status === 'searching_apollo' || status === 'apollo_found' || status === 'both_failed'
            ? 'bg-slate-950 border-white/[0.06] opacity-60'
            : 'bg-slate-950 border-white/[0.06]'
      )}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <Shield size={12} className="text-emerald-400" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">SignalHire</p>
              <p className="text-[10px] text-slate-500">Best for LinkedIn-matched contacts</p>
            </div>
          </div>
          {status === 'sh_found' && <CheckCircle2 size={14} className="text-emerald-400" />}
          {(status === 'sh_not_found' || status === 'searching_apollo' || status === 'apollo_found' || status === 'both_failed') && <XCircle size={14} className="text-slate-600" />}
        </div>
        {status === 'idle' || status === 'searching_sh' ? (
          <button className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors disabled:opacity-60"
            onClick={onSignalHire} disabled={isSHLoading}>
            {isSHLoading ? <><Loader2 size={12} className="animate-spin" /> Searching SignalHire…</> : <><Search size={12} /> Search SignalHire</>}
          </button>
        ) : (
          <p className="text-xs text-slate-500 text-center py-1">
            {status === 'sh_found' ? '✓ Contact found' : '✕ Not found in SignalHire'}
          </p>
        )}
      </div>

      {/* Apollo button */}
      <div className={cn(
        'rounded-xl border p-3.5 transition-all',
        isApolloLoading ? 'bg-violet-500/[0.08] border-violet-500/30'
          : status === 'apollo_found' ? 'bg-violet-500/[0.08] border-violet-500/30'
          : status === 'both_failed' ? 'bg-red-500/[0.06] border-red-500/20'
          : status === 'idle' || status === 'searching_sh' ? 'bg-slate-950 border-white/[0.06] opacity-50'
          : 'bg-slate-950 border-white/[0.06]'
      )}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-violet-500/20 flex items-center justify-center">
              <Search size={12} className="text-violet-400" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">Apollo.io</p>
              <p className="text-[10px] text-slate-500">Fallback — 200M+ contacts database</p>
            </div>
          </div>
          {status === 'apollo_found' && <CheckCircle2 size={14} className="text-violet-400" />}
          {status === 'both_failed' && <XCircle size={14} className="text-red-500" />}
        </div>
        {(status === 'sh_not_found' || status === 'searching_apollo' || status === 'apollo_found' || status === 'both_failed') ? (
          <button className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 transition-colors disabled:opacity-60"
            onClick={onApollo} disabled={isApolloLoading || status === 'apollo_found'}>
            {isApolloLoading ? <><Loader2 size={12} className="animate-spin" /> Searching Apollo…</>
              : status === 'apollo_found' ? '✓ Contact found'
              : status === 'both_failed' ? '✕ Not found — try again'
              : <><Search size={12} /> Search Apollo</>}
          </button>
        ) : (
          <p className="text-[10px] text-slate-600 text-center py-1">Runs automatically if SignalHire fails</p>
        )}
      </div>

      {status === 'both_failed' && (
        <div className="p-3 bg-amber-500/[0.06] border border-amber-500/20 rounded-xl">
          <p className="text-xs text-amber-400 text-center">
            No contact found in either database. Try adding a LinkedIn URL to improve search accuracy.
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc     = useQueryClient();
  const router = useRouter();
  const permissions = usePermissions();
  const user = useAuthStore((s) => s.user);

  const [enrichState, setEnrichState] = useState<EnrichState>({ status: 'idle' });
  const [aiTab,       setAiTab]       = useState<'analysis' | 'email'>('analysis');
  const [emailData,   setEmailData]   = useState<any>(null);
  const [sendLoading, setSendLoading] = useState(false);
  const [editingLinkedin, setEditingLinkedin] = useState(false);
  const [linkedinInput,   setLinkedinInput]   = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<any>({});

  // Auto-open edit form when navigated with ?edit=1
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('edit') === '1') {
        // Remove the param from the URL silently, then open edit
        const url = new URL(window.location.href);
        url.searchParams.delete('edit');
        window.history.replaceState(null, '', url.pathname + (url.search || ''));
        setIsEditing(true);
      }
    }
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['lead', id],
    queryFn:  () => leadsApi.get(id).then(r => r.data.data),
    staleTime: 30000,
  });

  const lead: any = data;
  const isOwnLead = lead?.assignedTo?.id === user?.id;
  const canEditThisLead = permissions.canEditAllLeads || (permissions.canEditOwnLeads && isOwnLead);

  // Populate editData when lead loads and edit mode is active
  useEffect(() => {
    if (isEditing && lead && Object.keys(editData).length === 0) {
      setEditData({
        status: lead.status,
        followUpDate: lead.followUpDate ? lead.followUpDate.split('T')[0] : '',
        disqualificationReason: lead.disqualificationReason || '',
        contactName: lead.contactName || '',
        contactEmail: lead.contactEmail || '',
        contactPhone: lead.contactPhone || '',
        contactTitle: lead.contactTitle || '',
        notes: lead.notes || '',
      });
    }
  }, [isEditing, lead]);

  const analyzeMutation = useMutation({
    mutationFn: () => leadsApi.analyze(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['lead', id] }); toast.success('Re-analyzed!'); },
    onError:    () => toast.error('Analysis failed'),
  });

  const saveLinkedinMutation = useMutation({
    mutationFn: (url: string) => leadsApi.update(id, { linkedinUrl: url }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['lead', id] }); setEditingLinkedin(false); toast.success('LinkedIn URL saved'); },
    onError:    () => toast.error('Save failed'),
  });

  const shMutation = useMutation({
    mutationFn: () => { setEnrichState({ status: 'searching_sh' }); return leadsApi.enrichSignalHire(id); },
    onSuccess: (res) => {
      const d = res.data.data;
      if (d.found) {
        setEnrichState({ status: 'sh_found', source: 'signalhire' });
        qc.invalidateQueries({ queryKey: ['lead', id] });
        toast.success('Contact found via SignalHire!');
      } else {
        setEnrichState({ status: 'sh_not_found' });
        toast('SignalHire: not found — trying Apollo next', { icon: 'ℹ️' });
      }
    },
    onError: () => { setEnrichState({ status: 'sh_not_found' }); toast('SignalHire failed', { icon: '⚠️' }); },
  });

  const apolloMutation = useMutation({
    mutationFn: () => { setEnrichState({ status: 'searching_apollo' }); return leadsApi.enrichApollo(id); },
    onSuccess: (res) => {
      const d = res.data.data;
      if (d.found) {
        setEnrichState({ status: 'apollo_found', source: 'apollo' });
        qc.invalidateQueries({ queryKey: ['lead', id] });
        toast.success('Contact found via Apollo!');
      } else {
        setEnrichState({ status: 'both_failed' });
        toast.error('Apollo: not found either.');
      }
    },
    onError: () => { setEnrichState({ status: 'both_failed' }); toast.error('Apollo search failed.'); },
  });

  const generateEmailMutation = useMutation({
    mutationFn: () => leadsApi.generateEmail(id),
    onSuccess: (res) => { setEmailData(res.data.data); setAiTab('email'); },
    onError: () => toast.error('Email generation failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => leadsApi.delete(id),
    onSuccess: () => {
      toast.success('Lead deleted successfully');
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      router.push('/dashboard/leads');
    },
    onError: () => toast.error('Failed to delete lead'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => leadsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead', id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Lead updated successfully');
      setIsEditing(false);
    },
    onError: () => toast.error('Failed to update lead'),
  });

  async function handleSend() {
    if (!emailData) return;
    setSendLoading(true);
    try {
      await leadsApi.sendOutreach(id, emailData);
      toast.success('Email sent!');
      qc.invalidateQueries({ queryKey: ['lead', id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch { toast.error('Send failed'); }
    finally { setSendLoading(false); }
  }

  function handleDelete() {
    if (deleteConfirm) {
      deleteMutation.mutate();
    } else {
      setDeleteConfirm(true);
      setTimeout(() => setDeleteConfirm(false), 3000);
    }
  }

  const FOLLOWUP_REQUIRED_STATUSES = ['new', 'contacted', 'replied'];
  const originalFollowUp = lead?.followUpDate ? lead.followUpDate.split('T')[0] : '';

  function handleSaveEdit() {
    // Validate past-date only if follow-up date is provided
    if (editData.followUpDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const fud = new Date(`${editData.followUpDate}T00:00:00`);
      if (fud < today) {
        toast.error('Follow-up date cannot be in the past');
        return;
      }
    }
    // Rule: disqualification reason required when status is disqualified
    if (editData.status === 'disqualified') {
      const reason = editData.disqualificationReason?.trim() || '';
      if (!reason) {
        toast.error('Disqualification reason is required');
        return;
      }
      if (reason.length < 10) {
        toast.error('Disqualification reason must be at least 10 characters');
        return;
      }
    }
    updateMutation.mutate(editData);
  }

  if (isLoading) return <div className="flex items-center justify-center h-64"><Spinner size={24} /></div>;
  if (!lead)     return <div className="text-slate-500 text-sm p-6">Lead not found</div>;

  const agg = lead.aggregated || {};
  const hasContact = !!(lead.contactName || lead.contactEmail || lead.contactTitle || lead.contactLinkedin || lead.contactPhone);
  const domainName = agg.domainName || (lead.website ? lead.website.replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0] : null);
  const websiteUrl = agg.website || (lead.website ? (lead.website.startsWith('http') ? lead.website : `https://${lead.website}`) : null);

  return (
    <div className="space-y-5 max-w-5xl">
      <Link href="/dashboard/leads"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300">
        <ArrowLeft size={15} /> Back to Leads
      </Link>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="card p-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Avatar initials={getInitials(lead.companyName)} size="lg" />
          <div>
            <h1 className="font-display text-xl font-bold text-slate-100">{lead.companyName}</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {/* Domain badge */}
              {domainName && (
                <span className="inline-flex items-center gap-1 text-xs bg-slate-800 border border-white/[0.08] text-slate-400 px-2.5 py-1 rounded-lg font-mono">
                  {domainName}
                </span>
              )}
              {/* Industry badge */}
              {(lead.industry || agg.industry) && (
                <span className="inline-flex items-center gap-1 text-xs bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2.5 py-1 rounded-lg">
                  <Building2 size={10} />
                  {lead.industry || agg.industry}
                </span>
              )}
              {/* Website link */}
              {websiteUrl && (
                <a href={websiteUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-blue-400 transition-colors">
                  <Globe size={11} /> Visit site
                </a>
              )}
              {/* LinkedIn */}
              {lead.linkedinUrl && (
                <a href={lead.linkedinUrl.startsWith('http') ? lead.linkedinUrl : `https://${lead.linkedinUrl}`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-blue-400 transition-colors">
                  <Linkedin size={11} /> LinkedIn
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canEditThisLead && (
            <button
              className="btn-ghost"
              onClick={() => {
                setIsEditing(true);
                setEditData({
                  status: lead.status,
                  followUpDate: lead.followUpDate ? lead.followUpDate.split('T')[0] : '',
                  disqualificationReason: lead.disqualificationReason || '',
                  contactName: lead.contactName || '',
                  contactEmail: lead.contactEmail || '',
                  contactPhone: lead.contactPhone || '',
                  contactTitle: lead.contactTitle || '',
                  notes: lead.notes || '',
                });
              }}
            >
              <Edit2 size={14} /> Edit Lead
            </button>
          )}
          <button className="btn-ghost" onClick={() => analyzeMutation.mutate()}
            disabled={analyzeMutation.isPending}>
            {analyzeMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Re-analyze
          </button>
          <button className="btn-primary" onClick={() => generateEmailMutation.mutate()}
            disabled={generateEmailMutation.isPending}>
            {generateEmailMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
            AI Email
          </button>
        </div>
      </div>

      {/* ── Inline Edit Form ─────────────────────────────────────────────── */}
      {isEditing && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">Edit Lead</h2>
            <button className="btn-ghost text-xs py-1 px-2" onClick={() => setIsEditing(false)}>
              <X size={13} /> Cancel
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Status</label>
              <select
                className="input"
                title="Lead status"
                value={editData.status || ''}
                onChange={(e) => setEditData((d: any) => ({ ...d, status: e.target.value }))}
              >
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="replied">Replied</option>
                <option value="meeting_booked">Meeting Booked</option>
                <option value="qualified">Qualified</option>
                <option value="disqualified">Disqualified</option>
              </select>
            </div>
            <div>
              <label className="label">Follow-up Date</label>
              <input
                className="input"
                type="date"
                title="Follow-up date"
                value={editData.followUpDate || ''}
                onChange={(e) => setEditData((d: any) => ({ ...d, followUpDate: e.target.value }))}
              />
            </div>
            {editData.status === 'disqualified' && (
              <div className="sm:col-span-2">
                <label className="label">Disqualification Reason <span className="text-red-400">*</span></label>
                <textarea
                  className="input h-20 resize-none"
                  value={editData.disqualificationReason || ''}
                  onChange={(e) => setEditData((d: any) => ({ ...d, disqualificationReason: e.target.value }))}
                  placeholder="Explain why this lead is disqualified (min 10 characters)..."
                />
              </div>
            )}
            <div>
              <label className="label">Contact Name</label>
              <input
                className="input"
                value={editData.contactName || ''}
                onChange={(e) => setEditData((d: any) => ({ ...d, contactName: e.target.value }))}
                placeholder="Contact full name"
              />
            </div>
            <div>
              <label className="label">Contact Email</label>
              <input
                className="input"
                type="email"
                value={editData.contactEmail || ''}
                onChange={(e) => setEditData((d: any) => ({ ...d, contactEmail: e.target.value }))}
                placeholder="contact@company.com"
              />
            </div>
            <div>
              <label className="label">Contact Phone</label>
              <input
                className="input"
                value={editData.contactPhone || ''}
                onChange={(e) => setEditData((d: any) => ({ ...d, contactPhone: e.target.value }))}
                placeholder="+91 XXXXX XXXXX"
              />
            </div>
            <div>
              <label className="label">Contact Title</label>
              <input
                className="input"
                value={editData.contactTitle || ''}
                onChange={(e) => setEditData((d: any) => ({ ...d, contactTitle: e.target.value }))}
                placeholder="e.g. CEO, CTO"
              />
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea
                className="input h-20 resize-none"
                value={editData.notes || ''}
                onChange={(e) => setEditData((d: any) => ({ ...d, notes: e.target.value }))}
                placeholder="Internal notes..."
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              className="btn-primary"
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save Changes
            </button>
            <button className="btn-ghost" onClick={() => setIsEditing(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-4 lg:col-span-2">

          {/* ── Aggregated Company Profile ───────────────────────────────── */}
          <div className="card p-5">
            <h2 className="section-title mb-4">Company Profile</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <InfoRow icon={<Globe size={12} className="text-blue-400" />}
                label="Website" value={websiteUrl || domainName}
                href={websiteUrl || undefined} copyable />
              <InfoRow icon={<span className="text-[10px] font-bold text-slate-400">DOM</span>}
                label="Domain Name" value={domainName} copyable />
              <InfoRow icon={<Building2 size={12} className="text-violet-400" />}
                label="Industry" value={lead.industry || agg.industry} />
              <InfoRow icon={<Users2 size={12} className="text-amber-400" />}
                label="Company Size" value={lead.companySize || agg.companySize} />
              <InfoRow icon={<MapPin size={12} className="text-pink-400" />}
                label="Location" value={lead.location || agg.location} />
              <InfoRow icon={<Linkedin size={12} className="text-blue-400" />}
                label="LinkedIn" value={lead.linkedinUrl}
                href={lead.linkedinUrl?.startsWith('http') ? lead.linkedinUrl : lead.linkedinUrl ? `https://${lead.linkedinUrl}` : undefined}
                copyable />
            </div>

            {/* Description */}
            {(lead.description || agg.description) && (
              <div className="mt-3 p-3 bg-slate-950 rounded-xl flex items-start gap-2">
                <FileText size={12} className="text-slate-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-slate-400 leading-relaxed">{lead.description || agg.description}</p>
              </div>
            )}

            {/* Edit LinkedIn */}
            <div className="mt-3 pt-3 border-t border-white/[0.06]">
              {editingLinkedin ? (
                <div className="flex items-center gap-2">
                  <input className="input text-xs flex-1"
                    placeholder="https://www.linkedin.com/company/your-company"
                    value={linkedinInput} onChange={e => setLinkedinInput(e.target.value)} autoFocus />
                  <button className="btn-primary text-xs py-1.5 px-3"
                    onClick={() => saveLinkedinMutation.mutate(linkedinInput)}
                    disabled={saveLinkedinMutation.isPending || !linkedinInput.trim()}>
                    {saveLinkedinMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                  </button>
                  <button className="btn-ghost text-xs py-1.5 px-3" onClick={() => setEditingLinkedin(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button className="text-xs text-slate-600 hover:text-blue-400 transition-colors flex items-center gap-1"
                  onClick={() => { setLinkedinInput(lead.linkedinUrl || ''); setEditingLinkedin(true); }}>
                  <Linkedin size={10} />
                  {lead.linkedinUrl ? 'Edit LinkedIn URL' : '+ Add LinkedIn URL (improves contact search)'}
                </button>
              )}
            </div>
          </div>

          {/* ── Contact Details ──────────────────────────────────────────── */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title">Contact Details</h2>
              {(enrichState.status === 'sh_found' || enrichState.status === 'apollo_found') && (
                <span className={cn(
                  'text-[10px] font-semibold px-2 py-0.5 rounded-full border',
                  enrichState.status === 'sh_found'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                    : 'bg-violet-500/10 text-violet-400 border-violet-500/25'
                )}>
                  ✓ via {enrichState.status === 'sh_found' ? 'SignalHire' : 'Apollo'}
                </span>
              )}
            </div>

            {/* Contact fields */}
            {hasContact && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                <InfoRow icon={<User size={12} className="text-slate-400" />}
                  label="Name" value={lead.contactName} />
                <InfoRow icon={<ChevronRight size={12} className="text-slate-400" />}
                  label="Title" value={lead.contactTitle} />
                <InfoRow icon={<Mail size={12} className="text-emerald-400" />}
                  label="Email" value={lead.contactEmail}
                  href={lead.contactEmail ? `mailto:${lead.contactEmail}` : undefined}
                  copyable />
                <InfoRow icon={<Phone size={12} className="text-amber-400" />}
                  label="Phone" value={lead.contactPhone} copyable />
                <InfoRow icon={<Linkedin size={12} className="text-blue-400" />}
                  label="Personal LinkedIn" value={lead.contactLinkedin}
                  href={lead.contactLinkedin?.startsWith('http') ? lead.contactLinkedin : lead.contactLinkedin ? `https://${lead.contactLinkedin}` : undefined}
                  copyable />
              </div>
            )}

            {/* Enrichment panel */}
            <EnrichPanel
              enrichState={enrichState}
              onSignalHire={() => shMutation.mutate()}
              onApollo={() => apolloMutation.mutate()}
              hasContact={hasContact}
            />
          </div>

          {/* ── Tech Stack ───────────────────────────────────────────────── */}
          {lead.techStack?.length > 0 && (
            <div className="card p-5">
              <h2 className="section-title mb-3">Tech Stack</h2>
              <div className="flex flex-wrap gap-2">
                {lead.techStack.map((t: string) => (
                  <span key={t} className="bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg px-3 py-1.5 text-sm font-medium">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Intent Signals ───────────────────────────────────────────── */}
          {lead.intentSignals?.length > 0 && (
            <div className="card p-5">
              <h2 className="section-title mb-3">Intent Signals</h2>
              <div className="space-y-2">
                {(lead.intentSignals as any[]).map((s: any, i: number) => (
                  <div key={i} className="p-3 bg-slate-950 rounded-xl border-l-2 border-blue-500/40 flex items-start gap-2.5">
                    <Zap size={13} className="text-amber-400 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-slate-300">{s.text ?? s.signalText ?? s}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Job Postings ─────────────────────────────────────────────── */}
          {lead.jobPostings?.length > 0 && (
            <div className="card p-5">
              <h2 className="section-title mb-3">Job Postings</h2>
              <div className="space-y-2">
                {(lead.jobPostings as any[]).map((jp: any, i: number) => (
                  <div key={i} className="p-3 bg-slate-950 rounded-xl">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-slate-200">{jp.title}</p>
                      {jp.postedAt && <span className="text-xs text-slate-500 flex-shrink-0">{jp.postedAt}</span>}
                    </div>
                    {jp.snippet && <p className="text-xs text-slate-500 mt-1 leading-relaxed line-clamp-2">{jp.snippet}</p>}
                    <div className="flex items-center gap-3 mt-2">
                      {jp.workArrangement && (
                        <span className="text-[10px] text-slate-500">{jp.workArrangement}</span>
                      )}
                      {jp.salary && (
                        <span className="text-[10px] text-emerald-400">{jp.salary}</span>
                      )}
                      {jp.url && (
                        <a href={jp.url} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] text-blue-400 hover:underline flex items-center gap-0.5">
                          View posting <ExternalLink size={9} />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Activities Timeline ──────────────────────────────────────── */}
          <div className="card p-5">
            <ActivitiesList leadId={id} />
          </div>
        </div>

        {/* ── Right sidebar ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Scores */}
          <div className="card p-5">
            <h2 className="section-title mb-4">AI Scores</h2>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-slate-500">Lead Score</p>
              <ScoreRing score={lead.leadScore} size={52} />
            </div>
            <div className="border-t border-white/[0.06] pt-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 mb-1">Intent Level</p>
                <Badge color={intentColors[lead.intentLevel] ?? 'gray'}>{lead.intentLevel}</Badge>
              </div>
              <span className={cn('font-display text-2xl font-bold', lead.intentScore >= 80 ? 'text-emerald-400' : 'text-amber-400')}>
                {lead.intentScore}%
              </span>
            </div>
          </div>

          {/* Status */}
          <div className="card p-5">
            <h2 className="section-title mb-3">Status</h2>
            <Badge color={statusColors[lead.status] ?? 'gray'}>{lead.status?.replace('_', ' ')}</Badge>
            {lead.source && (
              <p className="text-xs text-slate-600 mt-2">Source: {lead.source}</p>
            )}
            <div className="mt-3 pt-3 border-t border-white/[0.06]">
              <div className="flex items-center gap-2 text-xs">
                <Calendar size={12} className="text-slate-500" />
                <span className="text-slate-600">Follow-up:</span>
                <span className="text-slate-300">
                  {lead.followUpDate ? new Date(lead.followUpDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* AI Panel */}
          <div className="card p-5">
            <div className="flex gap-1 mb-4 p-1 bg-slate-950 rounded-xl">
              {(['analysis', 'email'] as const).map(tab => (
                <button key={tab} onClick={() => setAiTab(tab)}
                  className={cn('flex-1 py-1.5 rounded-lg text-xs font-medium transition-all',
                    aiTab === tab ? 'bg-blue-500/20 text-blue-300' : 'text-slate-500 hover:text-slate-300')}>
                  {tab === 'analysis' ? '🤖 Analysis' : '✉️ Email'}
                </button>
              ))}
            </div>

            {aiTab === 'analysis' && (
              <div className="space-y-3">
                {lead.aiSummary && (
                  <div className="p-3 bg-slate-950 rounded-xl">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Summary</p>
                    <p className="text-xs text-slate-300 leading-relaxed">{lead.aiSummary}</p>
                  </div>
                )}
                {lead.opportunity && (
                  <div className="p-3 bg-blue-500/[0.08] border border-blue-500/20 rounded-xl">
                    <p className="text-[10px] font-semibold text-blue-300 mb-1 uppercase tracking-wider">Opportunity</p>
                    <p className="text-xs text-slate-300 leading-relaxed">{lead.opportunity}</p>
                  </div>
                )}
                {lead.aiPitch && (
                  <div className="p-3 bg-emerald-500/[0.06] border border-emerald-500/20 rounded-xl">
                    <p className="text-[10px] font-semibold text-emerald-400 mb-1 uppercase tracking-wider">Pitch</p>
                    <p className="text-xs text-slate-300 leading-relaxed">{lead.aiPitch}</p>
                  </div>
                )}
                {!lead.aiSummary && (
                  <button className="btn-ghost w-full justify-center text-xs"
                    onClick={() => analyzeMutation.mutate()} disabled={analyzeMutation.isPending}>
                    {analyzeMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                    Run AI Analysis
                  </button>
                )}
              </div>
            )}

            {aiTab === 'email' && (
              <div className="space-y-3">
                {!lead.contactEmail && (
                  <div className="p-3 bg-amber-500/[0.08] border border-amber-500/20 rounded-xl">
                    <p className="text-xs text-amber-400">⚠ No email yet — use Contact Details to search SignalHire or Apollo.</p>
                  </div>
                )}
                {emailData ? (
                  <>
                    <div>
                      <p className="label mb-1">Subject</p>
                      <input className="input text-xs" title="Email subject" placeholder="Email subject"
                        value={emailData.subject}
                        onChange={e => setEmailData({ ...emailData, subject: e.target.value })} />
                    </div>
                    <div>
                      <p className="label mb-1">Body</p>
                      <textarea className="input text-xs h-44 resize-none leading-relaxed"
                        title="Email body" placeholder="Email body"
                        value={emailData.body}
                        onChange={e => setEmailData({ ...emailData, body: e.target.value })} />
                    </div>
                    <button className="btn-primary w-full justify-center" onClick={handleSend}
                      disabled={sendLoading || !lead.contactEmail}>
                      {sendLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={13} />}
                      Send Email
                    </button>
                    {!lead.contactEmail && (
                      <p className="text-xs text-center text-slate-600">Find a contact email first</p>
                    )}
                  </>
                ) : (
                  <button className="btn-ghost w-full justify-center text-xs"
                    onClick={() => generateEmailMutation.mutate()}
                    disabled={generateEmailMutation.isPending}>
                    {generateEmailMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
                    Generate AI Email
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
