'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leadsApi, contactsApi, dropdownsApi, opportunitiesApi, usersApi, activitiesApi } from '../../../../lib/api';
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
  ChevronRight, Trash2, UserCog, Calendar, DollarSign,
  Clock, TrendingUp, Edit2, Save, X, UserPlus, Plus,
  ChevronDown, Eye, Hash, MessageCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

function cn(...cls: (string | boolean | undefined | null)[]) {
  return cls.filter(Boolean).join(' ');
}

// Per-channel follow-up: after sending via a channel, the rep sets a follow-up
// date. "Mark sent" records it on the lead (followUpDate) and logs an activity.
function OutreachFollowUp({ pending, onMarkSent }: { pending: boolean; onMarkSent: (date: string) => void }) {
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().split('T')[0];
  });
  return (
    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-white/[0.06] space-y-2">
      <p className="label flex items-center gap-1.5"><Calendar size={12} /> Set follow-up after sending</p>
      <div className="flex gap-2">
        <input
          type="date"
          className="input text-xs flex-1"
          title="Follow-up date"
          value={date}
          min={today}
          onChange={e => setDate(e.target.value)}
        />
        <button
          className="btn-primary text-xs px-3 whitespace-nowrap"
          disabled={pending || !date}
          onClick={() => onMarkSent(date)}
        >
          {pending ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Mark sent
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type EnrichState =
  | { status: 'idle' }
  | { status: 'searching_apollo' }
  | { status: 'apollo_found'; source: 'apollo' }
  | { status: 'apollo_failed' };

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
    <div className="flex items-center gap-3 p-3 bg-slate-100 dark:bg-slate-950 rounded-xl group">
      <div className="w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-800 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">{label}</p>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" title={value}
            className="text-sm text-blue-400 hover:underline truncate block">{value}</a>
        ) : (
          <p className="text-sm text-slate-800 dark:text-slate-200 truncate" title={value}>{value}</p>
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

// One contact rendered as a table row: Name · Title · Email · Phone · LinkedIn (+ actions).
// `emails`/`phones` accept one or many values — all are listed one below another.
function ContactTableRow({
  name, title, emails, phones, linkedin, badge, canEdit, onEdit, onDelete, deleteArmed,
}: {
  name?: string | null; title?: string | null;
  emails?: (string | null | undefined)[]; phones?: (string | null | undefined)[];
  linkedin?: string | null; badge?: string;
  canEdit?: boolean; onEdit?: () => void; onDelete?: () => void; deleteArmed?: boolean;
}) {
  const liHref = linkedin ? (linkedin.startsWith('http') ? linkedin : `https://${linkedin}`) : undefined;
  const copy = (v: string) => { navigator.clipboard.writeText(v); toast.success('Copied!'); };
  const emailList = (emails || []).map(e => (e || '').trim()).filter(Boolean);
  const phoneList = (phones || []).map(p => (p || '').trim()).filter(Boolean);
  // Cap the visible length so a long value can't blow out the layout; the full
  // text stays reachable via the tooltip on hover.
  const truncate = (v: string, n: number) => (v.length > n ? v.slice(0, n) + '…' : v);
  return (
    <tr className="border-t border-slate-200 dark:border-white/[0.06] hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors align-top">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-800 dark:text-slate-200 cursor-default" title={name || undefined}>{name ? truncate(name, 25) : '—'}</span>
          {badge && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 whitespace-nowrap">{badge}</span>}
        </div>
      </td>
      <td className="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300 cursor-default" title={title || undefined}>{title ? truncate(title, 25) : '—'}</td>
      <td className="px-3 py-2.5">
        {emailList.length ? (
          <div className="space-y-1">
            {emailList.map((email, i) => (
              <span key={i} className="group/cell flex items-center gap-1.5">
                <a href={`mailto:${email}`} title={email} className="text-sm text-blue-400 hover:underline whitespace-nowrap">{truncate(email, 25)}</a>
                <button onClick={() => copy(email)} className="opacity-0 group-hover/cell:opacity-100 flex-shrink-0" title="Copy email"><Copy size={11} className="text-slate-400" /></button>
              </span>
            ))}
          </div>
        ) : <span className="text-sm text-slate-400">—</span>}
      </td>
      <td className="px-3 py-2.5">
        {phoneList.length ? (
          <div className="space-y-1">
            {phoneList.map((phone, i) => (
              <span key={i} className="group/cell flex items-center gap-1.5">
                <a href={`tel:${phone}`} title={phone} className="text-sm text-slate-700 dark:text-slate-300 hover:text-blue-400 whitespace-nowrap">{phone}</a>
                <button onClick={() => copy(phone)} className="opacity-0 group-hover/cell:opacity-100 flex-shrink-0" title="Copy phone"><Copy size={11} className="text-slate-400" /></button>
              </span>
            ))}
          </div>
        ) : <span className="text-sm text-slate-400">—</span>}
      </td>
      <td className="px-3 py-2.5">
        {liHref
          ? <a href={liHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-blue-400 hover:underline"><Linkedin size={12} /> Profile</a>
          : <span className="text-sm text-slate-400">—</span>}
      </td>
      {canEdit && (
        <td className="px-3 py-2.5 text-left whitespace-nowrap">
          {onEdit && <button onClick={onEdit} className="btn-ghost text-[10px] py-0.5 px-1.5 text-slate-400" title="Edit contact"><Edit2 size={12} /></button>}
          {onDelete && (
            <button onClick={onDelete}
              className={cn('btn-ghost text-[10px] py-0.5 px-1.5 ml-1', deleteArmed ? 'bg-red-500/20 text-red-400' : 'text-slate-400')}
              title="Delete contact">
              {deleteArmed ? <><Trash2 size={11} /> Confirm?</> : <Trash2 size={12} />}
            </button>
          )}
        </td>
      )}
    </tr>
  );
}

// A vertical list of text inputs with a "+" to add rows and an "×" to remove
// them — used for the Email and Phone fields so a contact can hold several of each.
function MultiFieldList({
  label, icon, values, onChange, placeholder, type, numeric, addLabel,
  inputClassName = 'input text-xs h-8 flex-1',
}: {
  label?: string; icon?: React.ReactNode; values: string[];
  onChange: (next: string[]) => void; placeholder?: string;
  type?: string; numeric?: boolean; addLabel: string; inputClassName?: string;
}) {
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const fieldLabel = (label || 'entry').toLowerCase();
  const update = (i: number, v: string) => {
    const next = [...values];
    // For phone fields, allow digits plus +, spaces, parentheses and hyphens
    // (e.g. "+1 (610) 676-1063"). Cap length to fit a fully formatted number.
    next[i] = numeric ? v.replace(/[^\d\s()+-]/g, '').slice(0, 20) : v;
    onChange(next);
  };
  const add = () => onChange([...values, '']);
  const remove = (i: number) => {
    const next = values.filter((_, idx) => idx !== i);
    onChange(next.length ? next : ['']);
    setConfirmIdx(null);
  };
  return (
    <div>
      {label && <label className="label mb-1 block">{label}</label>}
      <div className="space-y-1.5">
        {values.map((val, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {icon}
            <input
              className={inputClassName}
              type={type}
              inputMode={numeric ? 'tel' : undefined}
              maxLength={numeric ? 20 : undefined}
              placeholder={placeholder}
              value={val}
              onChange={e => update(i, e.target.value)}
            />
            {values.length > 1 && (
              <button type="button" onClick={() => setConfirmIdx(i)}
                className="btn-ghost p-1 text-slate-400 hover:text-red-400 flex-shrink-0" title="Remove">
                <X size={13} />
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={add}
          className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 font-medium">
          <Plus size={12} /> {addLabel}
        </button>
      </div>

      {/* Confirm before removing a row */}
      {confirmIdx !== null && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-12 pb-6 px-4 bg-black/60 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <Trash2 size={20} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">Remove {fieldLabel}</h3>
                <p className="text-sm text-slate-500 mt-1">Are you sure you want to remove this {fieldLabel}?</p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button type="button"
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                onClick={() => setConfirmIdx(null)}
              >
                No, Cancel
              </button>
              <button type="button"
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-sm font-semibold text-white transition-colors"
                onClick={() => remove(confirmIdx)}
              >
                Yes, Remove
              </button>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EnrichPanel — Apollo auto-enriches on scan; this button is a manual retry
// ─────────────────────────────────────────────────────────────────────────────

function EnrichPanel({
  enrichState, onApollo, onSignalHire, signalhireSubmitting = false, signalhireRevealing = 0, hasContact, isDiscoveryLead,
}: {
  enrichState: EnrichState; onApollo: () => void; onSignalHire: () => void;
  signalhireSubmitting?: boolean; signalhireRevealing?: number; hasContact: boolean; isDiscoveryLead: boolean;
}) {
  const signalhireBusy = signalhireSubmitting || signalhireRevealing > 0;
  const { status } = enrichState;

  // SignalHire button — only shown for leads generated via Lead Discovery (have a scanJobId).
  const signalhireButton = isDiscoveryLead ? (
    <button
      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-sky-500/10 border border-sky-500/25 text-sky-400 hover:bg-sky-500/20 transition-colors disabled:opacity-60"
      onClick={() => onSignalHire()} disabled={signalhireBusy}>
      {signalhireSubmitting
        ? <><Loader2 size={11} className="animate-spin" /> Submitting…</>
        : signalhireRevealing > 0
          ? <><Loader2 size={11} className="animate-spin" /> Revealing {signalhireRevealing} decision-maker{signalhireRevealing > 1 ? 's' : ''}…</>
          : <><Search size={11} /> Enrich via SignalHire</>}
    </button>
  ) : null;
  const isApolloLoading = status === 'searching_apollo';

  if (hasContact && (status === 'idle' || status === 'apollo_found' || status === 'apollo_failed')) {
    if (!isDiscoveryLead) return null;
    return (
      <div className="pt-3 border-t border-slate-200 dark:border-white/[0.05] mt-3 space-y-2">
        {signalhireButton}
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-3">
      <div className={cn(
        'rounded-xl border p-3.5 transition-all',
        isApolloLoading ? 'bg-violet-500/[0.08] border-violet-500/30'
          : status === 'apollo_found' ? 'bg-violet-500/[0.08] border-violet-500/30'
          : status === 'apollo_failed' ? 'bg-red-500/[0.06] border-red-500/20'
          : 'bg-slate-100 dark:bg-slate-950 border-slate-200 dark:border-white/[0.06]'
      )}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-violet-500/20 flex items-center justify-center">
              <Search size={12} className="text-violet-400" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Apollo.io</p>
              <p className="text-[10px] text-slate-500">200M+ contacts database</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status === 'apollo_found' && <CheckCircle2 size={14} className="text-violet-400" />}
            {status === 'apollo_failed' && <XCircle size={14} className="text-red-500" />}
          </div>
        </div>
        <button
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 transition-colors disabled:opacity-60"
          onClick={() => onApollo()} disabled={isApolloLoading}>
          {isApolloLoading ? <><Loader2 size={12} className="animate-spin" /> Searching Apollo…</>
            : status === 'apollo_found' ? <><Search size={12} /> Search Again</>
            : status === 'apollo_failed' ? <><Search size={12} /> Retry Apollo Search</>
            : <><Search size={12} /> Search Apollo</>}
        </button>
      </div>

      {/* SignalHire — only for leads generated via Lead Discovery */}
      {isDiscoveryLead && (
        <div className="rounded-xl border p-3.5 bg-slate-100 dark:bg-slate-950 border-slate-200 dark:border-white/[0.06]">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-lg bg-sky-500/20 flex items-center justify-center">
              <Search size={12} className="text-sky-400" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">SignalHire</p>
              <p className="text-[10px] text-slate-500">Email &amp; phone finder · async</p>
            </div>
          </div>
          <button
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 transition-colors disabled:opacity-60"
            onClick={() => onSignalHire()} disabled={signalhireBusy}>
            {signalhireSubmitting
              ? <><Loader2 size={12} className="animate-spin" /> Submitting…</>
              : signalhireRevealing > 0
                ? <><Loader2 size={12} className="animate-spin" /> Revealing {signalhireRevealing} decision-maker{signalhireRevealing > 1 ? 's' : ''}…</>
                : <><Search size={12} /> Enrich via SignalHire</>}
          </button>
          {signalhireRevealing > 0 ? (
            <>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-sky-500/15">
                <div className="h-full w-1/2 rounded-full bg-sky-400 animate-pulse" />
              </div>
              <p className="text-[10px] text-sky-400/80 mt-1.5 text-center">Fetching contacts from SignalHire… they'll appear in the table below.</p>
            </>
          ) : (
            <p className="text-[10px] text-slate-500 mt-1.5 text-center">Reveals up to 5 decision-makers · arrives via webhook.</p>
          )}
        </div>
      )}

      {status === 'apollo_failed' && (
        <div className="p-3 bg-amber-500/[0.06] border border-amber-500/20 rounded-xl">
          <p className="text-xs text-amber-400 text-center">
            No contact found. Check that the company website is correct and retry.
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

// ── Contact field validation ──────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(v: string) { return EMAIL_RE.test(v.trim()); }
function isValidPhone(v: string) {
  const trimmed = v.trim();
  // Allowed characters: digits, spaces, +, -, parentheses (e.g. "+1 (610) 676-1063")
  if (!/^[\d\s()+-]+$/.test(trimmed)) return false;
  if (trimmed.length > 20) return false;       // cap total length (digits + special chars)
  const digits = trimmed.replace(/\D/g, "");   // count only the digits
  return digits.length >= 3 && digits.length <= 20;
}
// Accepts linkedin.com/in/<handle> with or without https:// and www.
const LINKEDIN_RE = /^(https?:\/\/)?(www\.)?linkedin\.com\/in\/[a-zA-Z0-9-_%]+\/?$/;
function isValidLinkedin(v: string) { return LINKEDIN_RE.test(v.trim()); }
function isValidName(v: string) { return /[a-zA-Z]/.test(v); }   // must contain at least one letter

// ── Compose-window builders ────────────────────────────────────────────────
// All three open a pre-filled draft for one or more recipients. The user sends
// it themselves from their own mailbox (no backend send).
//  · mailto    → opens the OS default mail app (Outlook desktop, Apple Mail, …)
//  · Gmail     → opens Gmail web compose in a new tab
//  · Outlook   → opens Outlook on the web compose in a new tab
function buildMailtoUrl(to: string[], subject: string, body: string) {
  // mailto needs %20 for spaces (some clients show "+" literally), so encode manually.
  return `mailto:${to.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
// NOTE: encode with encodeURIComponent (spaces → %20), NOT URLSearchParams
// (spaces → "+"). Gmail decodes "+" as a space, but Outlook's compose endpoint
// keeps it literal — so "+" leaks into the draft. %20 is decoded by both.
function buildGmailUrl(to: string[], subject: string, body: string) {
  const q = `view=cm&fs=1&to=${to.map(encodeURIComponent).join(',')}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `https://mail.google.com/mail/?${q}`;
}
function buildOutlookUrl(to: string[], subject: string, body: string) {
  const q = `to=${to.map(encodeURIComponent).join(',')}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `https://outlook.office.com/mail/deeplink/compose?${q}`;
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc     = useQueryClient();
  const router = useRouter();
  const permissions = usePermissions();
  const user = useAuthStore((s) => s.user);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [enrichState, setEnrichState] = useState<EnrichState>({ status: 'idle' });
  const [aiTab,       setAiTab]       = useState<'analysis' | 'email' | 'whatsapp' | 'telegram'>('analysis');
  const [emailData,   setEmailData]   = useState<any>(null);
  const [chatMessage, setChatMessage] = useState(''); // WhatsApp / Telegram message body
  const [sendLoading, setSendLoading] = useState(false);
  // Which contacts (by email) the generated draft will be addressed to.
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const recipInitRef = useRef(false); // default-selects the primary contact once per draft
  // WhatsApp: wa.me only opens one chat, so this is a single value (not a Set).
  const [selectedPhone, setSelectedPhone] = useState<string>('');
  const [editingLinkedin, setEditingLinkedin] = useState(false);
  const [linkedinInput,   setLinkedinInput]   = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<any>({});

  // ── Opportunity section state ─────────────────────────────────────────────
  const OPP_STAGES = [
    { id: 'qualified',   label: 'Qualified' },
    { id: 'demo',        label: 'Demo' },
    { id: 'proposal',    label: 'Proposal' },
    { id: 'negotiation', label: 'Negotiation' },
    { id: 'closed_won',  label: 'Closed Won' },
    { id: 'closed_lost', label: 'Closed Lost' },
  ];
  const emptyOppForm = { opportunityName: '', stage: 'qualified', dealValue: 0, expectedCloseDate: '', assignedToId: '', notes: '' };
  const [oppDeleteConfirmId, setOppDeleteConfirmId] = useState<string | null>(null);
  const [oppCreateOpen,  setOppCreateOpen]  = useState(false);
  const [oppCreateForm,  setOppCreateForm]  = useState<any>(emptyOppForm);
  const [oppCreateError, setOppCreateError] = useState('');
  const [oppEditModal,   setOppEditModal]   = useState<any | null>(null);
  const [oppEditForm,    setOppEditForm]    = useState<any>({});
  const [oppEditError,   setOppEditError]   = useState('');
  const [oppViewModal,   setOppViewModal]   = useState<any | null>(null);

  // Multi-contact state
  const [isAddingContact,  setIsAddingContact]  = useState(false);
  const [newContact,       setNewContact]       = useState({ name: '', title: '', emails: [''], phones: [''], linkedins: [''] });
  const [contactDeleteId,  setContactDeleteId]  = useState<string | null>(null);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editContactData,  setEditContactData]  = useState<{ name: string; title: string; phones: string[]; emails: string[]; linkedin: string }>({ name: '', title: '', phones: [''], emails: [''], linkedin: '' });
  // >0 while SignalHire is asynchronously revealing N contacts (shows a progress indicator).
  const [signalhireRevealing, setSignalhireRevealing] = useState(0);

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

  // Lock body scroll whenever an opportunity modal is open
  const anyOppModalOpen = !!(oppCreateOpen || oppEditModal || oppViewModal || oppDeleteConfirmId);
  useEffect(() => {
    document.body.style.overflow = anyOppModalOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [anyOppModalOpen]);

  const { data, isLoading } = useQuery({
    queryKey: ['lead', id],
    queryFn:  () => leadsApi.get(id).then(r => r.data.data),
    staleTime: 0,
  });

  const { data: statusOptions } = useQuery({
    queryKey: ['dropdowns', 'lead_status'],
    queryFn: () => dropdownsApi.listByCategory('lead_status').then(r => r.data?.data || r.data || []),
    staleTime: 0,
  });

  const { data: leadTypeOptions = [] } = useQuery({
    queryKey: ['dropdowns', 'lead_type'],
    queryFn: () => dropdownsApi.listByCategory('lead_type').then(r => r.data?.data || r.data || []),
    staleTime: 0,
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
        leadType: lead.leadType || '',
        sourceUrl: lead.sourceUrl || (lead.website ? (lead.website.startsWith('http') ? lead.website : `https://${lead.website}`) : '') || '',
        keyword: lead.keyword || '',
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

  const apolloMutation = useMutation({
    mutationFn: () => { setEnrichState({ status: 'searching_apollo' }); return leadsApi.enrichApollo(id); },
    onSuccess: (res) => {
      const d = res.data.data;
      if (d.found) {
        setEnrichState({ status: 'apollo_found', source: 'apollo' });
        qc.invalidateQueries({ queryKey: ['lead', id] });
        qc.invalidateQueries({ queryKey: ['lead-contacts', id] });
        const count = d.contactsFound || 1;
        toast.success(`${count} contact${count > 1 ? 's' : ''} found via Apollo!`);
      } else {
        setEnrichState({ status: 'apollo_failed' });
        toast.error('No contact found in Apollo.');
      }
    },
    onError: () => { setEnrichState({ status: 'apollo_failed' }); toast.error('Apollo search failed.'); },
  });

  // SignalHire is webhook-based: this only SUBMITS the search; the contact is filled
  // in asynchronously when SignalHire pushes the result to our webhook. So we toast
  // "submitted" and refetch the lead a few times to pick up the async update.
  const signalhireMutation = useMutation({
    mutationFn: () => leadsApi.enrichSignalHire(id),
    onSuccess: (res) => {
      const d = res.data.data;
      if (d?.peopleFound) {
        // Company search → up to 5 decision-makers are being revealed asynchronously
        // and created as Contact records; show a progress indicator + refetch.
        toast(`SignalHire is revealing decision-makers`, { icon: '⏳' });
        setSignalhireRevealing(d.peopleFound);
        [8000, 20000, 40000].forEach(ms => setTimeout(() => {
          qc.invalidateQueries({ queryKey: ['lead', id] });
          qc.invalidateQueries({ queryKey: ['lead-contacts', id] });
        }, ms));
        setTimeout(() => setSignalhireRevealing(0), 45000);
      } else if (d?.found) {
        // Synchronous hit — contact already written to the lead.
        qc.invalidateQueries({ queryKey: ['lead', id] });
        qc.invalidateQueries({ queryKey: ['lead-contacts', id] });
        toast.success('Contact found via SignalHire!');
      } else if (d?.noContact) {
        toast.error('SignalHire found no contact — needs a person name or personal LinkedIn (a company/domain alone often returns nothing).');
      } else if (d?.pending || d?.submitted) {
        // Timed out the sync wait — webhook will still fill it in; refetch a few times.
        toast('SignalHire is still processing — the contact will appear shortly.', { icon: '⏳' });
        [8000, 20000, 40000].forEach(ms => setTimeout(() => {
          qc.invalidateQueries({ queryKey: ['lead', id] });
          qc.invalidateQueries({ queryKey: ['lead-contacts', id] });
        }, ms));
      } else {
        toast.error(`SignalHire not run: ${d?.reason || 'unknown'}`);
      }
    },
    onError: () => toast.error('SignalHire request failed.'),
  });

  const generateEmailMutation = useMutation({
    mutationFn: (contact?: { name?: string; title?: string | null }) => {
      // Use the explicitly passed contact, or the first checked recipient, or the first available.
      const recipient = contact ?? mailRecipients.find(r => selectedEmails.has(r.email)) ?? mailRecipients[0];
      return leadsApi.generateEmail(id, recipient ? { name: recipient.name, title: recipient.title } : undefined);
    },
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
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Lead updated successfully');
      setIsEditing(false);
    },
    onError: () => toast.error('Failed to update lead'),
  });

  // Records an outreach on a channel: sets the lead's follow-up date + last-contacted
  // timestamp, and logs an activity so it shows in the timeline and feeds reminders.
  const markSentMutation = useMutation({
    mutationFn: async ({ channel, followUp }: { channel: 'email' | 'whatsapp' | 'telegram'; followUp: string }) => {
      const label = channel === 'email' ? 'Email' : channel === 'whatsapp' ? 'WhatsApp' : 'Telegram';
      await leadsApi.update(id, { followUpDate: followUp, lastContactedAt: new Date().toISOString() });
      await activitiesApi.create({
        type: channel,
        leadId: id,
        description: `Sent ${label} message to ${lead?.contactName || 'contact'}`,
        ...(followUp ? { nextActionDate: followUp } : {}),
      }).catch(() => {}); // activity is best-effort; the follow-up date is the important part
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead', id] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['activities'] });
      qc.invalidateQueries({ queryKey: ['lead-activities', id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Marked as sent · follow-up set');
    },
    onError: () => toast.error('Failed to set follow-up'),
  });

  // ── Contacts (multiple per lead) ──────────────────────────────────────────
  const { data: contactsData, isLoading: contactsLoading } = useQuery({
    queryKey: ['lead-contacts', id],
    queryFn:  () => contactsApi.list({ leadId: id }).then(r => {
      const d = r.data;
      if (Array.isArray(d)) return d;
      if (Array.isArray(d?.data)) return d.data;
      return [];
    }),
    staleTime: 5000,
  });
  const savedContacts: any[] = contactsData ?? [];

  // Every contact (primary + saved) that has an email — the choices in the
  // "Send to" picker. Deduped by email; primary contact comes first.
  const mailRecipients = useMemo(() => {
    const list: { id: string; name: string; title?: string | null; email: string; badge?: string }[] = [];
    if (lead?.contactEmail) {
      list.push({ id: 'primary', name: lead.contactName || 'Primary contact', title: lead.contactTitle, email: lead.contactEmail, badge: 'Primary' });
    }
    for (const c of savedContacts) {
      const email = c.email || c.contactEmail;
      if (email) list.push({ id: c.id, name: c.name || c.contactName || 'Contact', title: c.title || c.contactTitle, email });
    }
    const seen = new Set<string>();
    return list.filter(r => {
      const k = r.email.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [lead?.contactEmail, lead?.contactName, lead?.contactTitle, savedContacts]);

  // When a draft is first generated, pre-select the primary contact (or first
  // available). After that the user is free to toggle, including deselecting all.
  useEffect(() => {
    if (!emailData) { recipInitRef.current = false; return; }
    if (!recipInitRef.current && mailRecipients.length) {
      const primary = mailRecipients.find(r => r.id === 'primary') || mailRecipients[0];
      setSelectedEmails(new Set([primary.email]));
      recipInitRef.current = true;
    }
  }, [emailData, mailRecipients]);

  // Every reachable phone number for this lead — primary contact + saved contacts
  // (each contact can have a main phone + additionalPhones) + company phone.
  // Deduped by digits-only comparison so the same number tagged two ways doesn't
  // show up twice. Primary first; company last.
  const phoneRecipients = useMemo(() => {
    const list: { key: string; name: string; title?: string | null; phone: string; badge?: string }[] = [];
    if (lead?.contactPhone) {
      list.push({
        key: 'primary',
        name: lead.contactName || 'Primary contact',
        title: lead.contactTitle,
        phone: lead.contactPhone,
        badge: 'Primary',
      });
    }
    for (const c of savedContacts) {
      const phones = [c.phone || c.contactPhone, ...(Array.isArray(c.additionalPhones) ? c.additionalPhones : [])].filter(Boolean);
      phones.forEach((p: string, i: number) => list.push({
        key: `${c.id}-${i}`,
        name: c.name || c.contactName || 'Contact',
        title: c.title || c.contactTitle,
        phone: p,
      }));
    }
    if (lead?.companyPhone) {
      list.push({ key: 'company', name: 'Company Phone', phone: lead.companyPhone, badge: 'Company' });
    }
    const seen = new Set<string>();
    return list.filter(r => {
      const digits = (r.phone || '').replace(/\D/g, '');
      if (!digits || seen.has(digits)) return false;
      seen.add(digits);
      return true;
    });
  }, [lead?.contactPhone, lead?.contactName, lead?.contactTitle, lead?.companyPhone, savedContacts]);

  // Default the WhatsApp target to the primary once the list resolves; if the
  // current selection disappears (contact deleted mid-session), fall back to
  // whatever the first available option is.
  useEffect(() => {
    if (!phoneRecipients.length) { setSelectedPhone(''); return; }
    const stillValid = phoneRecipients.some(r => r.phone === selectedPhone);
    if (!stillValid) setSelectedPhone(phoneRecipients[0].phone);
  }, [phoneRecipients, selectedPhone]);

  const addContactMutation = useMutation({
    mutationFn: (data: any) => contactsApi.create({ ...data, leadId: id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-contacts', id] });
      toast.success('Contact added');
      setIsAddingContact(false);
      setNewContact({ name: '', title: '', emails: [''], phones: [''], linkedins: [''] });
    },
    onError: () => toast.error('Failed to add contact'),
  });

  const deleteContactMutation = useMutation({
    mutationFn: (contactId: string) => contactsApi.delete(contactId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-contacts', id] });
      toast.success('Contact removed');
      setContactDeleteId(null);
    },
    onError: () => toast.error('Failed to remove contact'),
  });

  const updateContactMutation = useMutation({
    mutationFn: ({ contactId, data }: { contactId: string; data: any }) =>
      contactsApi.update(contactId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-contacts', id] });
      toast.success('Contact updated');
      setEditingContactId(null);
    },
    onError: () => toast.error('Failed to update contact'),
  });

  // The "Primary" contact is stored on the lead itself (contactName/Email/…),
  // not as a separate contacts record — so editing/deleting it updates the lead.
  const updatePrimaryMutation = useMutation({
    mutationFn: (data: any) => leadsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead', id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Contact updated');
      setEditingContactId(null);
    },
    onError: () => toast.error('Failed to update contact'),
  });

  const deletePrimaryMutation = useMutation({
    mutationFn: () => leadsApi.update(id, {
      contactName: null, contactEmail: null, contactPhone: null,
      contactTitle: null, contactLinkedin: null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead', id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Contact removed');
      setContactDeleteId(null);
    },
    onError: () => toast.error('Failed to remove contact'),
  });

  // ── Opportunities linked to this lead ─────────────────────────────────────
  const { data: oppData, isLoading: oppLoading } = useQuery({
    queryKey: ['lead-opportunities', id],
    queryFn:  () => opportunitiesApi.list({ leadId: id, limit: 100 }).then(r => {
      const d = r.data;
      if (Array.isArray(d?.data)) return d.data;
      if (Array.isArray(d))       return d;
      return [];
    }),
    staleTime: 5000,
  });
  const leadOpportunities: any[] = oppData ?? [];

  const { data: teamData } = useQuery({
    queryKey: ['team-members'],
    queryFn:  () => usersApi.list().then(r => r.data?.data ?? r.data ?? []),
    enabled:  !permissions.isSalesUser,
  });
  const teamMembers: any[] = Array.isArray(teamData) ? teamData : [];

  const createOppMutation = useMutation({
    mutationFn: (data: any) => opportunitiesApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-opportunities', id] });
      qc.invalidateQueries({ queryKey: ['opportunities'] });
      toast.success('Opportunity created');
      setOppCreateOpen(false);
      setOppCreateForm(emptyOppForm);
      setOppCreateError('');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.message || 'Failed to create opportunity';
      setOppCreateError(msg);
      toast.error(msg);
    },
  });

  const updateOppMutation = useMutation({
    mutationFn: ({ oppId, data }: { oppId: string; data: any }) => opportunitiesApi.update(oppId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-opportunities', id] });
      qc.invalidateQueries({ queryKey: ['opportunities'] });
      toast.success('Opportunity updated');
      setOppEditModal(null);
      setOppEditError('');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.message || 'Failed to update opportunity';
      setOppEditError(msg);
      toast.error(msg);
    },
  });

  const deleteOppMutation = useMutation({
    mutationFn: (oppId: string) => opportunitiesApi.delete(oppId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-opportunities', id] });
      qc.invalidateQueries({ queryKey: ['opportunities'] });
      toast.success('Opportunity deleted');
    },
    onError: () => toast.error('Failed to delete opportunity'),
  });

  function openOppEdit(opp: any) {
    setOppEditForm({
      opportunityName:   opp.opportunityName || opp.title || '',
      stage:             opp.stage           || 'qualified',
      dealValue:         opp.dealValue       ?? 0,
      expectedCloseDate: opp.expectedCloseDate ? new Date(opp.expectedCloseDate).toISOString().split('T')[0] : '',
      assignedToId:      opp.assignedToId    || '',
      notes:             opp.notes           || '',
    });
    setOppEditError('');
    setOppEditModal(opp);
  }

  function handleSaveOpp() {
    if (!oppEditModal) return;
    const payload: any = {
      opportunityName:   oppEditForm.opportunityName,
      stage:             oppEditForm.stage,
      dealValue:         Number(oppEditForm.dealValue),
      expectedCloseDate: oppEditForm.expectedCloseDate || undefined,
      notes:             oppEditForm.notes || undefined,
    };
    if (oppEditForm.assignedToId) payload.assignedToId = oppEditForm.assignedToId;
    updateOppMutation.mutate({ oppId: oppEditModal.id, data: payload });
  }

  function handleCreateOpp() {
    setOppCreateError('');

    if (!oppCreateForm.opportunityName?.trim()) {
      setOppCreateError('Opportunity Name is required.');
      return;
    }

    createOppMutation.mutate({
      leadId:            id,
      opportunityName:   oppCreateForm.opportunityName || undefined,
      stage:             oppCreateForm.stage,
      dealValue:         Number(oppCreateForm.dealValue),
      expectedCloseDate: oppCreateForm.expectedCloseDate || undefined,
      assignedToId:      oppCreateForm.assignedToId || undefined,
      notes:             oppCreateForm.notes || undefined,
    });
  }

  function fmtDate(dateStr?: string | null) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function fmtUSD(v: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(v || 0));
  }

  function startEditContact(c: any) {
    setEditingContactId(c.id);
    const emails = [c.email || c.contactEmail || '', ...(Array.isArray(c.additionalEmails) ? c.additionalEmails : [])].filter(Boolean);
    const phones = [c.phone || c.contactPhone || '', ...(Array.isArray(c.additionalPhones) ? c.additionalPhones : [])].filter(Boolean);
    setEditContactData({
      name:     c.name     || c.contactName     || '',
      title:    c.title    || c.contactTitle    || '',
      phones:   phones.length ? phones : [''],
      emails:   emails.length ? emails : [''],
      linkedin: c.linkedin || c.contactLinkedin || '',
    });
  }

  function startEditPrimary() {
    setEditingContactId('primary');
    setEditContactData({
      name:     lead.contactName     || '',
      title:    lead.contactTitle    || '',
      phones:   [lead.contactPhone   || ''],
      emails:   [lead.contactEmail   || ''],
      linkedin: lead.contactLinkedin || '',
    });
  }

  function handleSaveContact() {
    if (!editingContactId) return;
    const d = editContactData;
    // Primary contact lives on the lead record — validate then update the lead.
    if (editingContactId === 'primary') {
      const emails = d.emails.map(e => e.trim()).filter(Boolean);
      const phones = d.phones.map(p => p.trim()).filter(Boolean);
      if (d.name && !isValidName(d.name))             { toast.error('Enter a valid name (letters required)'); return; }
      const badEmail = emails.find(e => !isValidEmail(e));
      if (badEmail)                                   { toast.error(`Please enter a valid email address: ${badEmail}`); return; }
      const badPhone = phones.find(p => !isValidPhone(p));
      if (badPhone)                                   { toast.error('Phone must have 3 to 20 digits (you may use + ( ) - and spaces)'); return; }
      if (d.linkedin && !isValidLinkedin(d.linkedin)) { toast.error('Enter a valid LinkedIn profile URL (linkedin.com/in/…)'); return; }
      updatePrimaryMutation.mutate({
        contactName:     d.name,
        contactTitle:    d.title,
        contactEmail:    emails[0] || null,
        contactPhone:    phones[0] || null,
        contactLinkedin: d.linkedin || null,
      });
      return;
    }
    const emails = d.emails.map(e => e.trim()).filter(Boolean);
    const phones = d.phones.map(p => p.trim()).filter(Boolean);
    if (d.name && !isValidName(d.name))         { toast.error('Enter a valid name (letters required)'); return; }
    const badEmail = emails.find(e => !isValidEmail(e));
    if (badEmail)                               { toast.error(`Please enter a valid email address: ${badEmail}`); return; }
    const badPhone = phones.find(p => !isValidPhone(p));
    if (badPhone)                               { toast.error('Phone must have 3 to 20 digits (you may use + ( ) - and spaces)'); return; }
    if (d.linkedin && !isValidLinkedin(d.linkedin)) { toast.error('Enter a valid LinkedIn profile URL (linkedin.com/in/…)'); return; }
    updateContactMutation.mutate({
      contactId: editingContactId,
      data: {
        name:             d.name,
        title:            d.title,
        linkedin:         d.linkedin,
        email:            emails[0] || null,
        phone:            phones[0] || null,
        additionalEmails: emails.slice(1),
        additionalPhones: phones.slice(1),
      },
    });
  }

  function handleAddContact() {
    const name      = newContact.name.trim();
    const emails    = newContact.emails.map(e => e.trim()).filter(Boolean);
    const phones    = newContact.phones.map(p => p.trim()).filter(Boolean);
    const linkedins = newContact.linkedins.map(l => l.trim()).filter(Boolean);
    if (!emails.length && !phones.length && !linkedins.length && !name) {
      toast.error('Enter at least a name, email, phone, or LinkedIn');
      return;
    }
    // Per-field format validation
    if (name && !isValidName(name))                 { toast.error('Enter a valid name (letters required)'); return; }
    const badEmail = emails.find(e => !isValidEmail(e));
    if (badEmail)                                   { toast.error(`Please enter a valid email address: ${badEmail}`); return; }
    const badPhone = phones.find(p => !isValidPhone(p));
    if (badPhone)                                   { toast.error('Phone must have 3 to 20 digits (you may use + ( ) - and spaces)'); return; }
    const badLi = linkedins.find(l => !isValidLinkedin(l));
    if (badLi)                                      { toast.error('Enter a valid LinkedIn profile URL (linkedin.com/in/…)'); return; }
    addContactMutation.mutate({
      name:    newContact.name,
      title:   newContact.title,
      email:   emails[0]    || null,
      phone:   phones[0]    || null,
      linkedin: linkedins[0] || null,
      additionalEmails:       emails.slice(1),
      additionalPhones:       phones.slice(1),
      additionalLinkedinUrls: linkedins.slice(1),
    });
  }

  function handleContactDelete(contactId: string) {
    // Open the confirmation popup; actual delete happens from the modal.
    setContactDeleteId(contactId);
  }

  // Inline edit form shared by the primary contact and saved contacts.
  function renderContactEditor(saving: boolean) {
    return (
      <>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label mb-1 block">Name</label>
            <input className="input text-xs h-8 w-full" placeholder="Full name"
              value={editContactData.name}
              onChange={e => setEditContactData((d: any) => ({ ...d, name: e.target.value }))} />
          </div>
          <div>
            <label className="label mb-1 block">Title</label>
            <input className="input text-xs h-8 w-full" placeholder="Job title"
              value={editContactData.title}
              onChange={e => setEditContactData((d: any) => ({ ...d, title: e.target.value }))} />
          </div>
          <MultiFieldList
            label="Email" type="email" placeholder="name@company.com" addLabel="Add email"
            values={editContactData.emails}
            onChange={emails => setEditContactData((d: any) => ({ ...d, emails }))} />
          <MultiFieldList
            label="Phone" numeric placeholder="Add Phone Number" addLabel="Add phone"
            values={editContactData.phones}
            onChange={phones => setEditContactData((d: any) => ({ ...d, phones }))} />
          <div className="col-span-2">
            <label className="label mb-1 block">LinkedIn URL</label>
            <input className="input text-xs h-8 w-full" placeholder="https://www.linkedin.com/in/…"
              value={editContactData.linkedin}
              onChange={e => setEditContactData((d: any) => ({ ...d, linkedin: e.target.value }))} />
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          <button className="btn-primary text-xs py-1.5 px-3" onClick={handleSaveContact} disabled={saving}>
            {saving ? <><Loader2 size={11} className="animate-spin" /> Saving…</> : <><Save size={11} /> Save</>}
          </button>
          <button className="btn-ghost text-xs py-1.5 px-3" onClick={() => setEditingContactId(null)}><X size={11} /> Cancel</button>
        </div>
      </>
    );
  }

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

  function toggleRecipient(email: string) {
    setSelectedEmails(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  }

  // Open the AI draft in the chosen mail surface, addressed to every selected
  // contact. We don't send from the backend — the user sends from their mailbox.
  function openCompose(kind: 'gmail' | 'outlook' | 'default') {
    if (!emailData) return;
    const recipients = mailRecipients.filter(r => selectedEmails.has(r.email)).map(r => r.email);
    if (!recipients.length) { toast.error('Select at least one contact to send to'); return; }
    const subject = emailData.subject || '';
    const body    = emailData.body || '';
    if (kind === 'default') {
      window.location.href = buildMailtoUrl(recipients, subject, body);
      return;
    }
    const url = kind === 'gmail' ? buildGmailUrl(recipients, subject, body) : buildOutlookUrl(recipients, subject, body);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // WhatsApp: wa.me works with any phone number → opens a chat with the message
  // pre-filled. Uses whichever phone the rep picked in the "Send to" list (digits
  // only, keep the country code).
  function openWhatsApp() {
    const raw = (selectedPhone || '').trim();
    let phone = raw.replace(/\D/g, '');                 // digits only — drops +, spaces, dashes, parens
    if (phone.startsWith('00')) phone = phone.slice(2); // 00 = international dialing prefix → country code follows
    if (!phone) { toast.error('Pick a phone number to send to'); return; }
    // wa.me needs the FULL international number (country code + number). A national
    // number with no country code won't resolve, and WhatsApp then falls back to the
    // last-open chat — so warn instead of opening the wrong conversation.
    if (phone.length < 8) {
      toast.error('Number looks incomplete — include the country code (e.g. +1, +91) so WhatsApp opens the right chat.');
      return;
    }
    // api.whatsapp.com/send reliably navigates to the number's chat (opening the
    // existing conversation if one exists) — more consistent than the wa.me redirect,
    // which the WhatsApp Desktop app sometimes ignores and lands on the last chat.
    const textParam = chatMessage.trim() ? `&text=${encodeURIComponent(chatMessage)}` : '';
    window.open(`https://api.whatsapp.com/send?phone=${phone}${textParam}`, '_blank', 'noopener,noreferrer');
  }

  // Telegram can't open a chat by phone number, so we use the share URL: it opens
  // Telegram with the message pre-filled and lets the rep pick which chat to send to.
  function openTelegram() {
    if (!chatMessage.trim()) { toast.error('Type a message first'); return; }
    const site = lead.website ? (lead.website.startsWith('http') ? lead.website : `https://${lead.website}`) : '';
    const params = new URLSearchParams({ url: site, text: chatMessage });
    window.open(`https://t.me/share/url?${params.toString()}`, '_blank', 'noopener,noreferrer');
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
    <div className="space-y-5 w-full">
      <Link href="/dashboard/leads"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-500 dark:hover:text-slate-300">
        <ArrowLeft size={15} /> Back to Leads
      </Link>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="card p-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 min-w-0">
          <Avatar initials={getInitials(lead.companyName)} size="lg" />
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100 break-words">{lead.companyName}</h1>
            <div className="flex flex-col items-start gap-1.5 mt-1.5">
              {/* Domain badge */}
              {domainName && (
                <span className="inline-flex items-center gap-1 text-xs bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-white/[0.08] text-slate-400 px-2.5 py-1 rounded-lg font-mono break-all">
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
              {/* Visit Site + LinkedIn — single horizontal row, wraps if needed */}
              {(websiteUrl || lead.linkedinUrl) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* Website link */}
                  {websiteUrl && (
                    <a href={websiteUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-white/[0.08] text-slate-900 dark:text-slate-100 px-2.5 py-1 rounded-lg hover:text-blue-400 transition-colors">
                      <Globe size={11} /> Visit site
                    </a>
                  )}
                  {/* LinkedIn */}
                  {lead.linkedinUrl && (
                    <a href={lead.linkedinUrl.startsWith('http') ? lead.linkedinUrl : `https://${lead.linkedinUrl}`}
                      target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-white/[0.08] text-slate-900 dark:text-slate-100 px-2.5 py-1 rounded-lg hover:text-blue-400 transition-colors">
                      <Linkedin size={11} /> LinkedIn
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Job Postings — between lead name and AI Email button */}
        {lead.jobPostings?.length > 0 && (
          <div className="flex-1 min-w-[280px] space-y-2">
            {(lead.jobPostings as any[]).map((jp: any, i: number) => (
              <div key={i} className="p-3 bg-slate-100 dark:bg-slate-950 rounded-xl">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{jp.title}</p>
                  {/* {jp.postedAt && <span className="text-xs text-slate-500 flex-shrink-0">{jp.postedAt}</span>} */}
                </div>
                {/* {jp.snippet && <p className="text-xs text-slate-500 mt-1 leading-relaxed line-clamp-2">{jp.snippet}</p>} */}
                <div className="flex items-center gap-3 mt-2">
                  {/* {jp.workArrangement && (
                    <span className="text-[10px] text-slate-500">{jp.workArrangement}</span>
                  )} */}
                  {/* {jp.salary && (
                    <span className="text-[10px] text-emerald-400">{jp.salary}</span>
                  )} */}
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
        )}

        <div className="flex flex-col items-end gap-3">
          {/* <button className="btn-primary" onClick={() => generateEmailMutation.mutate()}
            disabled={generateEmailMutation.isPending}>
            {generateEmailMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
            AI Email
          </button> */}
          <div className="flex flex-col items-center gap-1">
            <ScoreRing score={lead.leadScore} size={70} />
            <p className="text-xm text-slate-500">Lead Score</p>
          </div>
        </div>
      </div>

      {/* ── Two-column layout: left = Lead Details / Company Profile · right = Analysis & Email ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:items-stretch">
        {/* ───────────────────────────── LEFT COLUMN ───────────────────────────── */}
        <div className="space-y-5 min-w-0">

      {/* ── View Mode Details ────────────────────────────────────────────── */}
      {!isEditing && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">Lead Details</h2>
            {canEditThisLead && (
              <button
                className="btn-ghost text-xs py-1 px-2"
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
                    leadType: lead.leadType || '',
                    sourceUrl: lead.sourceUrl || (lead.website ? (lead.website.startsWith('http') ? lead.website : `https://${lead.website}`) : '') || '',
                    keyword: lead.keyword || '',
                  });
                }}
              >
                <Edit2 size={13} /> Edit
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Status</p>
              <p className="text-sm text-slate-800 dark:text-slate-200 capitalize">{lead.status?.replace(/_/g, ' ') || '—'}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Job Title</p>
              <p className="text-sm text-slate-800 dark:text-slate-200">{lead.contactTitle || '—'}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Lead type</p>
              <p className="text-sm text-slate-800 dark:text-slate-200">
                {lead.leadType ? lead.leadType.charAt(0).toUpperCase() + lead.leadType.slice(1) : '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Follow-up Date</p>
              <p className="text-sm text-slate-800 dark:text-slate-200">
                {lead.followUpDate ? new Date(lead.followUpDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Assigned To</p>
              <p className="text-sm text-slate-800 dark:text-slate-200">{lead.assignedTo?.name || '—'}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Keyword</p>
              <p className="text-sm text-slate-800 dark:text-slate-200 break-words" title={lead.keyword || undefined}>{lead.keyword || '—'}</p>
            </div>
            {/* <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Contact Name</p>
              <p className="text-sm text-slate-800 dark:text-slate-200">{lead.contactName || '—'}</p>
            </div> */}
            {/* <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Contact Email</p>
              {lead.contactEmail ? (
                <a href={`mailto:${lead.contactEmail}`} className="text-sm text-blue-400 hover:underline">{lead.contactEmail}</a>
              ) : (
                <p className="text-sm text-slate-800 dark:text-slate-200">—</p>
              )}
            </div> */}
            {/* <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Contact Phone</p>
              {lead.contactPhone ? (
                <a href={`tel:${lead.contactPhone}`} className="text-sm text-blue-400 hover:underline">{lead.contactPhone}</a>
              ) : (
                <p className="text-sm text-slate-800 dark:text-slate-200">—</p>
              )}
            </div> */}
            {/* <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Source URL</p>
              {(() => {
                const url = lead.sourceUrl || (lead.website ? (lead.website.startsWith('http') ? lead.website : `https://${lead.website}`) : '');
                return url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-blue-400 hover:underline break-all">{url}</a>
                ) : (
                  <p className="text-sm text-slate-800 dark:text-slate-200">—</p>
                );
              })()}
            </div> */}
            {/* <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Lead Source</p>
              <p className="text-sm text-slate-800 dark:text-slate-200">{lead.source || '—'}</p>
            </div> */}
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Notes</p>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap max-h-[8.75rem] overflow-y-auto pr-1" title={lead.notes || undefined}>{lead.notes || '—'}</p>
            </div>
          </div>
        </div>
      )}

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
                {(statusOptions && statusOptions.length > 0 ? statusOptions : []).map((opt: any) => (
                  <option key={opt.id} value={opt.value.toLowerCase().replace(/\s+/g, '_')}>
                    {opt.value}
                  </option>
                ))}
              </select>
            </div>
            {/* <div>
              <label className="label">Contact Name</label>
              <input
                className="input"
                value={editData.contactName || ''}
                onChange={(e) => setEditData((d: any) => ({ ...d, contactName: e.target.value }))}
                placeholder="Contact full name"
              />
            </div> */}
            {/* <div>
              <label className="label">Contact Email</label>
              <input
                className="input"
                type="email"
                value={editData.contactEmail || ''}
                onChange={(e) => setEditData((d: any) => ({ ...d, contactEmail: e.target.value }))}
                placeholder="contact@company.com"
              />
            </div> */}
            {/* <div>
              <label className="label">Contact Phone</label>
              <input
                className="input"
                value={editData.contactPhone || ''}
                onChange={(e) => setEditData((d: any) => ({ ...d, contactPhone: e.target.value }))}
                placeholder="+91 XXXXX XXXXX"
              />
            </div> */}
            <div>
              <label className="label">Job Title</label>
              <input
                className="input"
                value={editData.contactTitle || ''}
                onChange={(e) => setEditData((d: any) => ({ ...d, contactTitle: e.target.value }))}
                placeholder="e.g. CEO, CTO"
              />
            </div>
            <div>
              <label className="label">Lead type</label>
              <select
                className="input"
                title="Product or Service type"
                value={editData.leadType || ''}
                onChange={(e) => setEditData((d: any) => ({ ...d, leadType: e.target.value }))}
              >
                <option value="">— Select —</option>
                {(leadTypeOptions as any[]).map((opt: any) => (
                  <option key={opt.id} value={opt.value.toLowerCase()}>
                    {opt.value}
                  </option>
                ))}
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
            <div>
              <label className="label">Source URL</label>
              <input
                className="input"
                type="url"
                value={editData.sourceUrl || ''}
                onChange={(e) => setEditData((d: any) => ({ ...d, sourceUrl: e.target.value }))}
                placeholder="https://..."
              />
            </div>
            <div>
              <label className="label">Keyword</label>
              <input
                className="input"
                type="text"
                value={editData.keyword || ''}
                onChange={(e) => setEditData((d: any) => ({ ...d, keyword: e.target.value }))}
                placeholder="e.g. NetSuite, SuiteCommerce"
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
              <InfoRow icon={<Phone size={12} className="text-amber-400" />}
                label="Company Phone" value={lead.companyPhone} copyable />
            </div>

            {/* Description */}
            {(lead.description || agg.description) && (
              <div className="mt-3 p-3 bg-slate-100 dark:bg-slate-950 rounded-xl flex items-start gap-2">
                <FileText size={12} className="text-slate-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-slate-400 leading-relaxed">{lead.description || agg.description}</p>
              </div>
            )}

          </div>
          {/* ─────────────────────────── /LEFT COLUMN ─────────────────────────── */}
        </div>

        {/* ──────────────────── RIGHT COLUMN — Analysis & Email ──────────────────── */}
        {/* The wrapper stretches to the left column's height (Lead Details + Company
            Profile); the panel fills it absolutely and scrolls internally, so the page
            never grows with Analysis content and the panel never exceeds the left side. */}
        <div className="min-w-0 lg:relative">
          <div className="card p-5 flex flex-col lg:absolute lg:inset-0">
            {/* Tabs — pinned to the top of the panel */}
            <div className="flex gap-1 mb-4 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl">
              {(['analysis', 'email', 'whatsapp', 'telegram'] as const).map(tab => (
                <button key={tab} onClick={() => setAiTab(tab)}
                  className={cn('flex-1 py-1.5 rounded-lg text-xs font-medium transition-all',
                    aiTab === tab ? 'bg-blue-500/20 text-blue-300' : 'text-slate-500 hover:text-slate-500 dark:hover:text-slate-300')}>
                  {tab === 'analysis' ? '🤖 Analysis' : tab === 'email' ? '✉️ Email' : tab === 'whatsapp' ? '💬 WhatsApp' : '✈️ Telegram'}
                </button>
              ))}
            </div>

            {/* Scrollable content — internal vertical scrollbar appears here if content overflows */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {aiTab === 'analysis' && (
                <div className="space-y-3">
                  {lead.aiSummary && (
                    <div className="p-3 bg-slate-100 dark:bg-slate-950 rounded-xl">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Summary</p>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{lead.aiSummary}</p>
                    </div>
                  )}
                  {lead.opportunity && (
                    <div className="p-3 bg-blue-500/[0.08] border border-blue-500/20 rounded-xl">
                      <p className="text-[10px] font-semibold text-blue-300 mb-1 uppercase tracking-wider">Opportunity</p>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{lead.opportunity}</p>
                    </div>
                  )}
                  {lead.aiPitch && (
                    <div className="p-3 bg-emerald-500/[0.06] border border-emerald-500/20 rounded-xl">
                      <p className="text-[10px] font-semibold text-emerald-400 mb-1 uppercase tracking-wider">Pitch</p>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{lead.aiPitch}</p>
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
                      <p className="text-xs text-amber-400">⚠ No email yet — use Contact Details to search Apollo.</p>
                    </div>
                  )}
                  {emailData ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <p className="label">Subject</p>
                        <button
                          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
                          onClick={() => {
                            const selected = mailRecipients.find(r => selectedEmails.has(r.email)) ?? mailRecipients[0];
                            generateEmailMutation.mutate(selected ? { name: selected.name, title: selected.title } : undefined);
                          }}
                          disabled={generateEmailMutation.isPending}
                          title="Regenerate email for the selected contact">
                          {generateEmailMutation.isPending ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                          Regenerate
                        </button>
                      </div>
                      <input className="input text-xs" title="Email subject" placeholder="Email subject"
                        value={emailData.subject}
                        onChange={e => setEmailData({ ...emailData, subject: e.target.value })} />
                      <div>
                        <p className="label mb-1">Body</p>
                        <textarea className="input text-xs h-44 resize-none leading-relaxed"
                          title="Email body" placeholder="Email body"
                          value={emailData.body}
                          onChange={e => setEmailData({ ...emailData, body: e.target.value })} />
                      </div>
                    {/* Recipient picker — pick one or more contacts to address the draft to */}
                    <div>
                      <p className="label mb-1 flex items-center justify-between">
                        <span>Send to</span>
                        {selectedEmails.size > 0 && (
                          <span className="text-[10px] font-normal text-slate-400">{selectedEmails.size} selected</span>
                        )}
                      </p>
                      {mailRecipients.length === 0 ? (
                        <p className="text-xs text-amber-400">No contact email yet — add one in Contact Details first.</p>
                      ) : (
                        <div className="space-y-0.5 max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-white/[0.08] p-1.5">
                          {mailRecipients.map(r => (
                            <label key={r.id}
                              className="flex items-start gap-2 px-1.5 py-1 rounded-md cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/50">
                              <input type="checkbox" className="mt-0.5 accent-blue-500 cursor-pointer"
                                checked={selectedEmails.has(r.email)}
                                onChange={() => toggleRecipient(r.email)} />
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1.5">
                                  <span className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">{r.name}</span>
                                  {r.badge && <span className="text-[9px] font-semibold px-1 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 whitespace-nowrap">{r.badge}</span>}
                                </span>
                                <span className="block text-[11px] text-slate-400 truncate">{r.email}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Open the draft in Gmail / Outlook web, or the OS default mail app */}
                    <div className="grid grid-cols-2 gap-2">
                      <button className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                        onClick={() => openCompose('gmail')} disabled={selectedEmails.size === 0}>
                        <Mail size={13} /> Gmail
                      </button>
                      <button className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-sky-500/10 border border-sky-500/25 text-sky-400 hover:bg-sky-500/20 transition-colors disabled:opacity-50"
                        onClick={() => openCompose('outlook')} disabled={selectedEmails.size === 0}>
                        <Mail size={13} /> Outlook
                      </button>
                      <button className="col-span-2 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-white/[0.08] text-slate-700 dark:text-slate-200 hover:bg-slate-300/70 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                        onClick={() => openCompose('default')} disabled={selectedEmails.size === 0}>
                        <Send size={12} /> Default Mail App
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500 text-center">Opens a pre-filled draft — you send it from your own mailbox.</p>
                    </>
                  ) : (
                    <button className="btn-ghost w-full justify-center text-xs"
                      onClick={() => generateEmailMutation.mutate(undefined)}
                      disabled={generateEmailMutation.isPending}>
                      {generateEmailMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
                      Generate AI Email
                    </button>
                  )}
                  <OutreachFollowUp
                    pending={markSentMutation.isPending}
                    onMarkSent={(d) => markSentMutation.mutate({ channel: 'email', followUp: d })}
                  />
                </div>
              )}

              {aiTab === 'whatsapp' && (
                <div className="space-y-3">
                  {phoneRecipients.length === 0 && (
                    <div className="p-3 bg-amber-500/[0.08] border border-amber-500/20 rounded-xl">
                      <p className="text-xs text-amber-400">⚠ No phone number yet — add one in Contact Details.</p>
                    </div>
                  )}
                  <div>
                    <p className="label mb-1 flex items-center justify-between">
                      <span>Message</span>
                      {emailData?.body && (
                        <button className="text-[10px] text-slate-400 hover:text-slate-200 transition-colors"
                          onClick={() => setChatMessage(emailData.body)}>Use AI email text</button>
                      )}
                    </p>
                    <textarea className="input text-xs h-40 resize-none leading-relaxed"
                      placeholder="Type or paste your WhatsApp message…"
                      value={chatMessage}
                      onChange={e => setChatMessage(e.target.value)} />
                  </div>
                  {phoneRecipients.length > 0 && (
                    <div>
                      <p className="label mb-1">Send to</p>
                      <div className="space-y-0.5 max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-white/[0.08] p-1.5">
                        {phoneRecipients.map(r => (
                          <label key={r.key}
                            className="flex items-start gap-2 px-1.5 py-1 rounded-md cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/50">
                            <input type="radio" name="wa-phone" className="mt-0.5 accent-green-500 cursor-pointer"
                              checked={selectedPhone === r.phone}
                              onChange={() => setSelectedPhone(r.phone)} />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">{r.name}</span>
                                {r.title && <span className="text-[10px] text-slate-500 truncate">· {r.title}</span>}
                                {r.badge && <span className="text-[9px] font-semibold px-1 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 whitespace-nowrap">{r.badge}</span>}
                              </span>
                              <span className="block text-[11px] text-slate-400 truncate">{r.phone}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <button className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-green-500/10 border border-green-500/25 text-green-400 hover:bg-green-500/20 transition-colors disabled:opacity-50"
                    onClick={openWhatsApp} disabled={!selectedPhone}>
                    <MessageCircle size={13} /> Open in WhatsApp
                  </button>
                  <p className="text-[10px] text-slate-500 text-center">Opens WhatsApp with your message pre-filled — you send it yourself.</p>
                  <OutreachFollowUp
                    pending={markSentMutation.isPending}
                    onMarkSent={(d) => markSentMutation.mutate({ channel: 'whatsapp', followUp: d })}
                  />
                </div>
              )}

              {aiTab === 'telegram' && (
                <div className="space-y-3">
                  <div>
                    <p className="label mb-1 flex items-center justify-between">
                      <span>Message</span>
                      {emailData?.body && (
                        <button className="text-[10px] text-slate-400 hover:text-slate-200 transition-colors"
                          onClick={() => setChatMessage(emailData.body)}>Use AI email text</button>
                      )}
                    </p>
                    <textarea className="input text-xs h-40 resize-none leading-relaxed"
                      placeholder="Type or paste your Telegram message…"
                      value={chatMessage}
                      onChange={e => setChatMessage(e.target.value)} />
                  </div>
                  <button className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-sky-500/10 border border-sky-500/25 text-sky-400 hover:bg-sky-500/20 transition-colors"
                    onClick={openTelegram}>
                    <Send size={13} /> Open in Telegram
                  </button>
                  <p className="text-[10px] text-slate-500 text-center">Telegram can’t open a chat by phone — this opens Telegram with your message pre-filled; pick the contact to send.</p>
                  <OutreachFollowUp
                    pending={markSentMutation.isPending}
                    onMarkSent={(d) => markSentMutation.mutate({ channel: 'telegram', followUp: d })}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* ─────────────────────────── /Two-column layout ─────────────────────────── */}

      {/* ── Contact Details (full width) ─────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-title">Contact Details</h2>
              <div className="flex items-center gap-2">
                {enrichState.status === 'apollo_found' && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-violet-500/10 text-violet-400 border-violet-500/25">
                    ✓ via Apollo
                  </span>
                )}
                {canEditThisLead && (
                  <button
                    className="btn-ghost text-xs py-1 px-2.5 flex items-center gap-1.5"
                    onClick={() => { setIsAddingContact(v => !v); }}
                  >
                    <UserPlus size={12} />
                    Add Contact
                  </button>
                )}
              </div>
            </div>

            {/* ── Contacts table (primary + additional) ── */}
            {contactsLoading ? (
              <div className="py-2 flex items-center gap-2 text-xs text-slate-500">
                <Loader2 size={12} className="animate-spin" /> Loading contacts…
              </div>
            ) : (hasContact || savedContacts.length > 0) ? (
              <div className="mb-4 rounded-xl border border-slate-200 dark:border-white/[0.06] overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100 dark:bg-slate-900 text-slate-500">
                    <tr>
                      <th className="text-left text-[10px] font-semibold uppercase tracking-wider px-3 py-2">Name</th>
                      <th className="text-left text-[10px] font-semibold uppercase tracking-wider px-3 py-2">Title</th>
                      <th className="text-left text-[10px] font-semibold uppercase tracking-wider px-3 py-2">Email</th>
                      <th className="text-left text-[10px] font-semibold uppercase tracking-wider px-3 py-2">Phone</th>
                      <th className="text-left text-[10px] font-semibold uppercase tracking-wider px-3 py-2">LinkedIn</th>
                      {canEditThisLead && <th className="text-left text-[10px] font-semibold uppercase tracking-wider px-3 py-2">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {hasContact && (
                      editingContactId === 'primary' ? (
                        <tr className="border-t border-slate-200 dark:border-white/[0.06] bg-blue-500/[0.04]">
                          <td colSpan={canEditThisLead ? 6 : 5} className="p-3">
                            {renderContactEditor(updatePrimaryMutation.isPending)}
                          </td>
                        </tr>
                      ) : (
                        <ContactTableRow
                          name={lead.contactName} title={lead.contactTitle}
                          emails={[lead.contactEmail]} phones={[lead.contactPhone]} linkedin={lead.contactLinkedin}
                          badge="Primary"
                          canEdit={canEditThisLead}
                          onEdit={startEditPrimary}
                          onDelete={() => handleContactDelete('primary')}
                          deleteArmed={false}
                        />
                      )
                    )}
                    {savedContacts.map((c: any) => (
                      editingContactId === c.id ? (
                        <tr key={c.id} className="border-t border-slate-200 dark:border-white/[0.06] bg-blue-500/[0.04]">
                          <td colSpan={canEditThisLead ? 6 : 5} className="p-3">
                            {renderContactEditor(updateContactMutation.isPending)}
                          </td>
                        </tr>
                      ) : (
                        <ContactTableRow
                          key={c.id}
                          name={c.name || c.contactName} title={c.title || c.contactTitle}
                          emails={[c.email || c.contactEmail, ...(Array.isArray(c.additionalEmails) ? c.additionalEmails : [])]}
                          phones={[c.phone || c.contactPhone, ...(Array.isArray(c.additionalPhones) ? c.additionalPhones : [])]}
                          linkedin={c.linkedin || c.contactLinkedin || (Array.isArray(c.additionalLinkedinUrls) ? c.additionalLinkedinUrls[0] : null)}
                          canEdit={canEditThisLead}
                          onEdit={() => startEditContact(c)}
                          onDelete={() => handleContactDelete(c.id)}
                          deleteArmed={false}
                        />
                      )
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {/* ── Add new contact form ── */}
            {isAddingContact && (
              <div className="border border-blue-500/30 bg-blue-500/[0.04] rounded-xl p-3 mb-4">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2.5 flex items-center gap-1.5">
                  <UserPlus size={12} className="text-blue-400" /> New Contact
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="flex items-center gap-1.5">
                    <User size={11} className="text-slate-400 flex-shrink-0" />
                    <input className="input text-sm h-8 flex-1" placeholder="Full name"
                      value={newContact.name}
                      onChange={e => setNewContact(c => ({ ...c, name: e.target.value }))} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ChevronRight size={11} className="text-slate-400 flex-shrink-0" />
                    <input className="input text-sm h-8 flex-1" placeholder="Title"
                      value={newContact.title}
                      onChange={e => setNewContact(c => ({ ...c, title: e.target.value }))} />
                  </div>
                  <MultiFieldList
                    icon={<Mail size={11} className="text-emerald-400 flex-shrink-0" />}
                    type="email" placeholder="Email address" addLabel="Add email"
                    inputClassName="input text-sm h-8 flex-1"
                    values={newContact.emails}
                    onChange={emails => setNewContact(c => ({ ...c, emails }))} />
                  <MultiFieldList
                    icon={<Phone size={11} className="text-amber-400 flex-shrink-0" />}
                    numeric placeholder="Add Phone Number" addLabel="Add phone"
                    inputClassName="input text-sm h-8 flex-1"
                    values={newContact.phones}
                    onChange={phones => setNewContact(c => ({ ...c, phones }))} />
                  <div className="flex items-center gap-1.5 sm:col-span-2">
                    <Linkedin size={11} className="text-blue-400 flex-shrink-0" />
                    <input className="input text-sm h-8 flex-1" placeholder="LinkedIn URL"
                      value={newContact.linkedins[0] ?? ''}
                      onChange={e => setNewContact(c => { const linkedins = [...c.linkedins]; linkedins[0] = e.target.value; return { ...c, linkedins }; })} />
                  </div>
                </div>
                <div className="flex gap-2 mt-2.5">
                  <button
                    className="btn-primary text-xs py-1.5 px-4"
                    onClick={handleAddContact}
                    disabled={addContactMutation.isPending}
                  >
                    {addContactMutation.isPending
                      ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
                      : <><CheckCircle2 size={12} /> Save Contact</>}
                  </button>
                  <button className="btn-ghost text-xs py-1.5 px-3"
                    onClick={() => { setIsAddingContact(false); setNewContact({ name: '', title: '', emails: [''], phones: [''], linkedins: [''] }); }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* ── When no contact at all exists ── */}
            {!hasContact && savedContacts.length === 0 && !isAddingContact && (
              <div className="py-4 text-center">
                <p className="text-xs text-slate-600 mb-3">No contact details yet</p>
                {canEditThisLead && (
                  <button className="btn-ghost text-xs py-1.5 px-3 mx-auto flex items-center gap-1.5"
                    onClick={() => setIsAddingContact(true)}>
                    <UserPlus size={12} /> Add a Contact
                  </button>
                )}
              </div>
            )}

            {/* ── Enrichment panel ── */}
            <EnrichPanel
              enrichState={enrichState}
              onApollo={() => apolloMutation.mutate()}
              onSignalHire={() => signalhireMutation.mutate()}
              signalhireSubmitting={signalhireMutation.isPending}
              signalhireRevealing={signalhireRevealing}
              hasContact={hasContact}
              isDiscoveryLead={true} /* SignalHire enabled for all leads, including manually-added ones */
            />
          </div>

          {/* ── Opportunities ────────────────────────────────────────────── */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title">Opportunities ({leadOpportunities.length})</h2>
              {permissions.canCreateOpportunities && (
                <button
                  className="btn-ghost text-xs py-1 px-2.5 flex items-center gap-1.5"
                  onClick={() => { setOppCreateOpen(true); setOppCreateForm(emptyOppForm); setOppCreateError(''); }}
                >
                  <Plus size={12} /> Add Opportunity
                </button>
              )}
            </div>

            {oppLoading && (
              <div className="flex items-center gap-2 text-xs text-slate-500 py-3">
                <Loader2 size={12} className="animate-spin" /> Loading…
              </div>
            )}

            {!oppLoading && leadOpportunities.length === 0 && (
              <div className="py-6 text-center">
                <p className="text-xs text-slate-500 mb-3">No opportunities linked to this lead yet</p>
                {permissions.canCreateOpportunities && (
                  <button className="btn-ghost text-xs py-1.5 px-3 mx-auto flex items-center gap-1.5"
                    onClick={() => { setOppCreateOpen(true); setOppCreateForm(emptyOppForm); }}>
                    <Plus size={12} /> Add Opportunity
                  </button>
                )}
              </div>
            )}

            {/* ── Create opportunity form ── */}
            {oppCreateOpen && (
              <div className="mb-4 border border-blue-500/30 bg-blue-500/[0.04] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Plus size={12} className="text-blue-400" /> New Opportunity
                  </p>
                  <button onClick={() => setOppCreateOpen(false)}>
                    <X size={14} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" />
                  </button>
                </div>

                {/* Opportunity Name (full row) */}
                <div>
                  <label className="label mb-1 block">Opportunity Name <span className="text-red-400">*</span></label>
                  <input className="input" placeholder="e.g. ERP Implementation Proposal"
                    value={oppCreateForm.opportunityName}
                    onChange={e => setOppCreateForm((f: any) => ({ ...f, opportunityName: e.target.value }))} />
                </div>

                {/* Contact Person (auto from lead, read-only) */}
                <div>
                  <label className="label mb-1 block">Contact Person</label>
                  <input className="input bg-slate-50 dark:bg-slate-800 cursor-not-allowed text-slate-500"
                    readOnly value={lead.contactName || '—'} />
                </div>

                {/* Stage */}
                <div>
                  <label className="label mb-1 block">Stage / Status</label>
                  <select className="input" value={oppCreateForm.stage}
                    onChange={e => setOppCreateForm((f: any) => ({ ...f, stage: e.target.value }))}>
                    {OPP_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>

                {/* Deal Value + Expected Close Date */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label mb-1 block">Deal Value</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium pointer-events-none">$</span>
                      <input className="input pl-7" type="number" min="0" placeholder="0"
                        value={oppCreateForm.dealValue}
                        onChange={e => setOppCreateForm((f: any) => ({ ...f, dealValue: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label className="label mb-1 block">Expected Close Date</label>
                    <input className="input" type="date"
                      onKeyDown={e => e.preventDefault()}
                      value={oppCreateForm.expectedCloseDate}
                      onChange={e => setOppCreateForm((f: any) => ({ ...f, expectedCloseDate: e.target.value }))} />
                  </div>
                </div>

                {/* ASSIGNED TO (managers only) - HIDDEN (do not remove)
                {!permissions.isSalesUser && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label mb-1 block">Assigned To</label>
                      <select className="input" value={oppCreateForm.assignedToId}
                        onChange={e => setOppCreateForm((f: any) => ({ ...f, assignedToId: e.target.value }))}>
                        <option value="">— Select assignee —</option>
                        {teamMembers.map((m: any) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </div>
                    <div />
                  </div>
                )}
                */}

                {/* Notes */}
                <div>
                  <label className="label mb-1 block">Notes / Comments</label>
                  <textarea className="input min-h-[60px] resize-none" placeholder="Add notes..."
                    value={oppCreateForm.notes}
                    onChange={e => setOppCreateForm((f: any) => ({ ...f, notes: e.target.value }))} />
                </div>

                {oppCreateError && <p className="text-xs text-red-400">{oppCreateError}</p>}

                <div className="flex gap-2 pt-1">
                  <button className="btn-ghost flex-1" onClick={() => setOppCreateOpen(false)}>Cancel</button>
                  <button className="btn-primary flex-1" onClick={handleCreateOpp}
                    disabled={createOppMutation.isPending}>
                    {createOppMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    Create Opportunity
                  </button>
                </div>
              </div>
            )}

            {/* Opportunities table */}
            {leadOpportunities.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/[0.06]">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-white/[0.06] bg-slate-50 dark:bg-slate-800/30">
                      <th className="text-left py-2.5 px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Opportunity</th>
                      <th className="text-left py-2.5 px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Stage</th>
                      <th className="text-left py-2.5 px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Contact</th>
                      <th className="text-left py-2.5 px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Deal Value</th>
                      <th className="text-left py-2.5 px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Close Date</th>
                      <th className="text-left py-2.5 px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Notes / Comments</th>
                      <th className="text-left py-2.5 px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leadOpportunities.map((opp: any) => (
                      <tr key={opp.id} className="border-b border-slate-100 dark:border-white/[0.04] hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors last:border-0">
                        <td className="py-2.5 px-3 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                          {opp.opportunityName || opp.title}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 capitalize whitespace-nowrap">
                          {opp.stage?.replace(/_/g, ' ')}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500">
                          {opp.contact?.name || opp.lead?.contactName || lead.contactName || '—'}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-emerald-400 whitespace-nowrap">
                          {fmtUSD(opp.dealValue)}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                          {opp.expectedCloseDate ? fmtDate(opp.expectedCloseDate) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 max-w-[200px] truncate">
                          {opp.notes || '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button title="View"
                              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-blue-400 transition-colors"
                              onClick={() => setOppViewModal(opp)}>
                              <Eye size={12} />
                            </button>
                            <button title="Edit"
                              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition-colors"
                              onClick={() => openOppEdit(opp)}>
                              <Edit2 size={12} />
                            </button>
                            {(permissions.canDeleteOpportunities || (permissions.isSalesUser && opp.assignedToId === user?.id)) && (
                              <button title="Delete"
                                className="p-1 rounded hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors"
                                disabled={deleteOppMutation.isPending}
                                onClick={() => setOppDeleteConfirmId(opp.id)}>
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
                  <div key={i} className="p-3 bg-slate-100 dark:bg-slate-950 rounded-xl border-l-2 border-blue-500/40 flex items-start gap-2.5">
                    <Zap size={13} className="text-amber-400 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-slate-600 dark:text-slate-300">{s.text ?? s.signalText ?? s}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Activities Timeline ──────────────────────────────────────── */}
          <div className="card p-5">
            <ActivitiesList leadId={id} />
          </div>

      {/* ── Opportunity Delete Confirmation Modal ──────────────────────────── */}
      {mounted && oppDeleteConfirmId && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-12 pb-6 px-4 bg-black/60 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <Trash2 size={20} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">Delete Opportunity</h3>
                <p className="text-sm text-slate-500 mt-1">Are you sure you want to delete this opportunity? This action cannot be undone.</p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                onClick={() => setOppDeleteConfirmId(null)}
              >
                No, Cancel
              </button>
              <button
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-sm font-semibold text-white transition-colors disabled:opacity-60"
                disabled={deleteOppMutation.isPending}
                onClick={() => {
                  deleteOppMutation.mutate(oppDeleteConfirmId);
                  setOppDeleteConfirmId(null);
                }}
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      , document.body)}

      {/* ── Contact Delete Confirmation Modal ──────────────────────────────── */}
      {mounted && contactDeleteId && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-12 pb-6 px-4 bg-black/60 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <Trash2 size={20} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">Delete Contact</h3>
                <p className="text-sm text-slate-500 mt-1">Are you sure you want to delete this contact? This action cannot be undone.</p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                onClick={() => setContactDeleteId(null)}
              >
                No, Cancel
              </button>
              <button
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-sm font-semibold text-white transition-colors disabled:opacity-60"
                disabled={deleteContactMutation.isPending || deletePrimaryMutation.isPending}
                onClick={() => contactDeleteId === 'primary'
                  ? deletePrimaryMutation.mutate()
                  : deleteContactMutation.mutate(contactDeleteId)}
              >
                {(deleteContactMutation.isPending || deletePrimaryMutation.isPending) ? <><Loader2 size={13} className="animate-spin" /> Deleting…</> : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      , document.body)}

      {/* ── Opportunity Edit Modal ──────────────────────────────────────────── */}
      {mounted && oppEditModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-12 pb-6 px-4 bg-black/60 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="section-title">Edit Opportunity</h3>
                {/* {oppEditModal.opportunityId && (
                  <p className="text-[10px] font-mono text-slate-400 mt-0.5 flex items-center gap-0.5">
                    <Hash size={9} />{oppEditModal.opportunityId}
                  </p>
                )} */}
              </div>
              <button onClick={() => setOppEditModal(null)}>
                <X size={16} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label mb-1 block">Opportunity Name</label>
                <input className="input" value={oppEditForm.opportunityName}
                  onChange={e => setOppEditForm((f: any) => ({ ...f, opportunityName: e.target.value }))} />
              </div>
              <div>
                <label className="label mb-1 block">Contact Person</label>
                <input className="input bg-slate-50 dark:bg-slate-800 cursor-not-allowed text-slate-500"
                  readOnly value={oppEditModal.contact?.name || lead.contactName || '—'} />
              </div>
              <div>
                <label className="label mb-1 block">Stage / Status</label>
                <select className="input" value={oppEditForm.stage}
                  onChange={e => setOppEditForm((f: any) => ({ ...f, stage: e.target.value }))}>
                  {OPP_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1 block">Deal Value</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium pointer-events-none">$</span>
                    <input className="input pl-7" type="number" min="0" placeholder="0" value={oppEditForm.dealValue}
                      onChange={e => setOppEditForm((f: any) => ({ ...f, dealValue: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="label mb-1 block">Expected Close Date</label>
                  <input className="input" type="date" onKeyDown={e => e.preventDefault()} value={oppEditForm.expectedCloseDate}
                    onChange={e => setOppEditForm((f: any) => ({ ...f, expectedCloseDate: e.target.value }))} />
                </div>
              </div>
              {/* ASSIGNED TO (managers only) - HIDDEN (do not remove)
              {!permissions.isSalesUser && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label mb-1 block">Assigned To</label>
                    <select className="input" value={oppEditForm.assignedToId}
                      onChange={e => setOppEditForm((f: any) => ({ ...f, assignedToId: e.target.value }))}>
                      <option value="">— Select assignee —</option>
                      {teamMembers.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <div />
                </div>
              )}
              */}
              <div>
                <label className="label mb-1 block">Notes / Comments</label>
                <textarea className="input min-h-[70px] resize-none" value={oppEditForm.notes}
                  onChange={e => setOppEditForm((f: any) => ({ ...f, notes: e.target.value }))} />
              </div>
              {oppEditError && <p className="text-xs text-red-400">{oppEditError}</p>}
              <div className="flex gap-2 pt-1">
                <button className="btn-ghost flex-1" onClick={() => setOppEditModal(null)}>Cancel</button>
                <button className="btn-primary flex-1" onClick={handleSaveOpp} disabled={updateOppMutation.isPending}>
                  {updateOppMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      , document.body)}

      {/* ── Opportunity View Modal ──────────────────────────────────────────── */}
      {mounted && oppViewModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-12 pb-6 px-4 bg-black/60 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="section-title">{oppViewModal.opportunityName || oppViewModal.title}</h3>
                {/* {oppViewModal.opportunityId && (
                  <p className="text-[10px] font-mono text-slate-400 mt-0.5 flex items-center gap-0.5">
                    <Hash size={9} />{oppViewModal.opportunityId}
                  </p>
                )} */}
              </div>
              <button onClick={() => setOppViewModal(null)}>
                <X size={16} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                { label: 'Linked Lead',     value: lead.companyName },
                { label: 'Contact Person',  value: oppViewModal.contact?.name || lead.contactName },
                { label: 'Stage / Status',  value: OPP_STAGES.find(s => s.id === oppViewModal.stage)?.label || oppViewModal.stage },
                { label: 'Deal Value',      value: fmtUSD(oppViewModal.dealValue) },
                { label: 'Expected Close',  value: fmtDate(oppViewModal.expectedCloseDate) },
                // ASSIGNED TO - HIDDEN (do not remove)
                // { label: 'Assigned To',     value: oppViewModal.assignedTo?.name || 'Unassigned' },
                { label: 'Created By',      value: oppViewModal.createdBy?.name },
                { label: 'Created Date',    value: fmtDate(oppViewModal.createdAt) },
                { label: 'Last Updated',    value: fmtDate(oppViewModal.updatedAt) },
              ].map(({ label, value }) => (
                <div key={label} className="bg-slate-50 dark:bg-slate-950 rounded-xl p-3">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</p>
                  <p className="text-sm text-slate-800 dark:text-slate-200">{value || '—'}</p>
                </div>
              ))}
              {oppViewModal.wonLostReason && (
                <div className="col-span-2 bg-slate-50 dark:bg-slate-950 rounded-xl p-3">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Won / Lost Reason</p>
                  <p className="text-sm text-slate-800 dark:text-slate-200">{oppViewModal.wonLostReason}</p>
                </div>
              )}
              <div className="col-span-2 bg-slate-50 dark:bg-slate-950 rounded-xl p-3">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Notes / Comments</p>
                <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{oppViewModal.notes || '—'}</p>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button className="btn-ghost flex-1" onClick={() => setOppViewModal(null)}>Close</button>
              <button className="btn-primary flex-1"
                onClick={() => { openOppEdit(oppViewModal); setOppViewModal(null); }}>
                <Edit2 size={13} /> Edit
              </button>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
}
