'use client';
import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { discoveryApi, leadsApi, dropdownsApi } from '../../../lib/api';
import { Badge } from '../../../components/ui';
import { PageHero } from '../../../components/ui/PageHero';
import { usePermissions } from '../../../lib/rbac';
import { ShieldOff } from 'lucide-react';
import {
  X, Zap, Loader2, CheckCircle2,
  Link2, FileText,
  ChevronDown, ChevronUp, Upload, ExternalLink,
  Target, Users, Edit3,
  Sparkles, ArrowRight, RotateCcw,
  Eye, Lightbulb, Copy, Check,
  Radar, Briefcase, Package, SlidersHorizontal, MapPin, Search, Rocket,
  History, Calendar, Minus, Plus, AlertCircle, ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { formatDate } from '../../../lib/utils';
import { Select } from '../../../components/ui/Select';

const ACTIVE_SCAN_KEY = 'lf_active_scan_id';

// Inline panel that loads the leads belonging to a single scan (expandable row in
// Scan History). Fetches only when rendered (i.e. when the row is expanded).
function ScanLeadsPanel({ scanId }: { scanId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['scan-leads', scanId],
    queryFn: () => leadsApi.list({ scanJobId: scanId, limit: 100 }).then(r => r.data),
  });
  const leads = (data?.data as any[]) ?? [];
  if (isLoading) return <div className="flex items-center gap-2 px-3 py-3 text-xs text-ink-3"><Loader2 size={13} className="animate-spin" /> Loading leads…</div>;
  if (!leads.length) return <div className="px-3 py-3 text-xs text-ink-3">No leads stored for this scan.</div>;
  return (
    <div className="rounded-xl border border-line overflow-x-auto bg-white dark:bg-surface">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 dark:bg-white/[0.03]">
          <tr>
            <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-ink-3 px-3 py-2.5">Company</th>
            <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-ink-3 px-3 py-2.5">Score</th>
            <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-ink-3 px-3 py-2.5">Keyword</th>
            <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-ink-3 px-3 py-2.5">Source</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l: any) => {
            const score = l.leadScore ?? 0;
            return (
              <tr key={l.id} className="border-t border-slate-100 dark:border-white/[0.04] hover:bg-blue-50/50 dark:hover:bg-blue-500/[0.04] transition-colors">
                <td className="px-3 py-2.5">
                  <Link href={`/dashboard/leads/${l.id}`} className="font-semibold text-ink hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                    {l.companyName || l.contactName || '—'}
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <span className={cn(
                    'inline-flex items-center justify-center min-w-[32px] px-1.5 py-0.5 rounded-md text-[11px] font-bold tabular-nums',
                    score >= 80 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : score >= 50 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'bg-slate-400/10 text-ink-3'
                  )}>{score}</span>
                </td>
                <td className="px-3 py-2.5 text-ink-2 truncate max-w-[180px]">{l.keyword || '—'}</td>
                <td className="px-3 py-2.5 text-ink-2 truncate max-w-[180px]">{l.source || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Fetches a scan's in-memory kept/filtered activity feed on demand (getScanStatus
// returns it from the bounded scanEvents Map). Only recent scans still held in
// memory will have events; older ones render nothing. Not persisted to the DB.
function ScanActivityPanel({ scanId }: { scanId: string }) {
  const { data } = useQuery({
    queryKey: ['scan-events', scanId],
    queryFn: () => discoveryApi.getScanStatus(scanId).then(r => r.data?.data ?? r.data),
  });
  const events = Array.isArray((data as any)?.events) ? (data as any).events : [];
  return <ScanActivity events={events} />;
}

const DEFAULT_INDUSTRIES = [
  'Any Industry',
  'Information Technology (IT)',
  'Software / SaaS',
  'Banking & Financial Services (BFSI)',
  'Healthcare & Pharmaceuticals',
  'Manufacturing & Industrial',
  'Retail & E-commerce',
  'Education & EdTech',
  'Logistics & Supply Chain',
  'Real Estate & Construction',
  'Media & Advertising',
  'Telecommunications',
  'Energy & Utilities',
  'Automotive',
  'Government & Public Sector',
  'NGO / Non-profit',
  'Hospitality & Travel',
  'Agriculture & Food Processing',
  'Legal & Compliance',
  'Consulting & Professional Services',
];
const DEFAULT_COMPANY_SIZES = [
  'Any Size', '1-10 (Micro)', '11-50 (Small)', '51-200 (Mid-size)',
  '201-500 (Growing)', '501-1000 (Large)', '1000-5000 (Enterprise)', '5000+ (Global Enterprise)',
];
const DEFAULT_COMPANY_TYPES = [
  'Any', 'Private Limited', 'Public Listed', 'Startup', 'MNC', 'SME',
  'Government / PSU', 'NGO / Non-profit', 'Partnership Firm', 'LLP',
  'Sole Proprietorship', 'Family Business',
];
const DEFAULT_DECISION_MAKERS = [
  'CEO / Founder', 'CTO / CIO', 'CFO', 'CMO', 'COO', 'MD / Director',
  'VP Sales', 'VP Operations', 'Head of HR', 'Talent Acquisition Manager',
  'Procurement Head', 'Operations Manager', 'Department Head', 'Board Member',
];
const DEFAULT_CONTACT_CHANNELS = [
  'Any', 'Email', 'LinkedIn', 'Phone / Call', 'WhatsApp', 'In-person / Visit',
];
const DEFAULT_SENIORITY_LEVELS = [
  'Any', 'C-suite', 'VP / SVP Level', 'Director Level', 'Manager Level',
  'Team Lead', 'Individual Contributor', 'Board / Advisor Level',
];
const DEFAULT_ANNUAL_REVENUE = [
  'Any', 'Under $1M', '$1M – $5M', '$5M – $10M', '$10M – $25M', '$25M – $50M',
  '$50M – $100M', '$100M – $250M', '$250M – $500M', '$500M – $1B', 'Above $1B',
];

function cn(...cls: (string | boolean | undefined | null)[]) {
  return cls.filter(Boolean).join(' ');
}

const SECTION_TONES: Record<string, string> = {
  blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  cyan: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
};

function SectionCard({
  title, subtitle, defaultOpen = true, icon: Icon, tone = 'blue', children,
}: { title: string; subtitle?: string; defaultOpen?: boolean; icon?: React.ElementType; tone?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors text-left">
        {Icon && (
          <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', SECTION_TONES[tone] ?? SECTION_TONES.blue)}>
            <Icon size={18} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="section-title">{title}</p>
          {subtitle && <p className="text-xs text-ink-3 mt-0.5">{subtitle}</p>}
        </div>
        <span className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-ink-3 bg-slate-100 dark:bg-white/[0.04] transition-transform duration-200',
          open && 'rotate-180'
        )}>
          <ChevronDown size={15} />
        </span>
      </button>
      {open && <div className="px-5 pb-5 border-t border-slate-100 dark:border-white/[0.05]">{children}</div>}
    </div>
  );
}

function MandatoryLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="label mb-1.5 flex items-center gap-1">
      {children}
      <span className="text-rose-500 text-xs font-bold">*</span>
    </p>
  );
}

// Mandatory label with a "See example" (eye) button on the right that opens a
// worked example + tips for the field.
function MandatoryLabelWithHelp({ label, onHelp }: { label: string; onHelp: () => void }) {
  return (
    <div className="flex items-center justify-between mb-1.5">
      <span className="label mb-0 flex items-center gap-1">
        {label}
        <span className="text-rose-500 text-xs font-bold">*</span>
      </span>
      <button type="button" onClick={onHelp}
        className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-500/[0.08] hover:bg-blue-500/15 transition-colors">
        <Eye size={12} /> See example
      </button>
    </div>
  );
}

// ── "What to enter" examples for the mandatory free-text fields ──
const DESCRIPTION_EXAMPLE = `We provide NetSuite and SuiteCommerce Advanced (SCA) services: SuiteCommerce/SCA development and customization, SuiteScript and SuiteFlow work, NetSuite implementation, and ecommerce migrations (e.g. replacing Magento or Shopify Plus).

Find companies that already use — or are adopting — NetSuite / SuiteCommerce and need development, customization, integration, or migration help. Ideal targets are mid-market ecommerce, retail, distribution, and manufacturing firms. Treat both active hiring and buying-intent discussions as opportunities.

Buying-intent signals to prioritize: "looking for SuiteCommerce developer", "need NetSuite consultant", "SuiteCommerce migration", "SuiteCommerce performance issues", "SuiteScript help required", "NetSuite integration issues", "replacing Magento", "replacing Shopify Plus", "NetSuite partner recommendation".

Exclude NetSuite and Oracle themselves, and NetSuite/SCA consulting or implementation agencies and staffing firms — they are providers, not buyers.

Sources to search: LinkedIn, Indeed, Glassdoor, Dice, Wellfound, ZipRecruiter, Reddit, Quora, Stack Overflow, Dev.to, Medium, Hacker News.`;

const DESCRIPTION_TIPS = [
  'Name your exact services and the specific platforms/tech you work with — be concrete, not generic.',
  'Describe your ideal customer: industry, company size, and region.',
  'List the buying-intent phrases to prioritize (e.g. "looking for…", "need…", "migrating from…").',
  "Exclude vendors, competitors, and agencies — they're providers, not buyers.",
  'Name the sources / portals to search (LinkedIn, Indeed, Reddit, Quora, …).',
];

const SKILLS_EXAMPLE = `NetSuite, SuiteCommerce, SuiteCommerce Advanced, SCA, SuiteScript, SuiteFlow, SuiteTalk, RESTlets, SDF, NetSuite ecommerce, ecommerce migration`;

const SKILLS_TIPS = [
  'Comma-separated keywords, technologies, and product names that signal the need.',
  'Include acronyms and module names (e.g. SCA, SuiteScript, RESTlets, SDF).',
  'Add adjacent tools and phrases (e.g. "ecommerce migration") to widen matching.',
  'These anchor the search queries and the AI relevance scoring.',
];

// Modal showing a worked example + tips, with "Use this example" to auto-fill.
function HelpExampleModal({
  title, intro, example, tips, onUse, onClose,
}: {
  title: string; intro: string; example: string; tips: string[];
  onUse: () => void; onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(example);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-10 pb-6 px-4 bg-slate-950/60 backdrop-blur-[2px] overflow-y-auto animate-fade-in"
      onClick={onClose}>
      <div className="bg-white dark:bg-surface border border-line rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="h-1 w-full bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500" />
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/[0.06]">
          <h3 className="font-display text-[15px] font-semibold text-ink flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Lightbulb size={17} />
            </span>
            {title}
          </h3>
          <button onClick={onClose} title="Close" className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/[0.06] transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          <p className="text-[13px] text-ink-2 leading-relaxed">{intro}</p>
          <div>
            <p className="label mb-2">Example</p>
            <pre className="text-xs text-ink-2 dark:text-slate-300 bg-slate-50 dark:bg-white/[0.03] border border-line rounded-xl p-4 whitespace-pre-wrap leading-relaxed font-sans">{example}</pre>
          </div>
          <div>
            <p className="label mb-2">Tips</p>
            <ul className="space-y-2">
              {tips.map((t, i) => (
                <li key={i} className="text-[13px] text-ink-2 dark:text-slate-300 flex items-start gap-2">
                  <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" /> {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex items-center gap-2 px-5 py-4 border-t border-slate-100 dark:border-white/[0.06] bg-slate-50/60 dark:bg-white/[0.02]">
          <button onClick={copy} className="btn-ghost text-xs flex items-center gap-1.5">
            {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
          </button>
          <div className="flex-1" />
          <button onClick={onClose} className="btn-ghost text-xs">Close</button>
          <button onClick={() => { onUse(); onClose(); }} className="btn-primary text-xs flex items-center gap-1.5">
            <Sparkles size={13} /> Use this example
          </button>
        </div>
      </div>
    </div>
  );
}

function ChipSelect({
  options, selected, onToggle, color = 'violet',
}: { options: string[]; selected: string[]; onToggle: (v: string) => void; color?: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => {
        const active = selected.includes(opt);
        return (
          <button key={opt} type="button" onClick={() => onToggle(opt)}
            aria-pressed={active}
            className={cn(
              'flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold border transition-all duration-150',
              active
                ? 'bg-gradient-to-r from-violet-500 to-indigo-500 border-transparent text-white shadow-md shadow-violet-500/25'
                : 'bg-white dark:bg-white/[0.03] border-line text-ink-2 hover:border-violet-300 hover:text-violet-700 hover:bg-violet-50 dark:hover:border-violet-500/40 dark:hover:text-violet-300 dark:hover:bg-violet-500/[0.06]'
            )}>
            {active
              ? <Check size={12} className="flex-shrink-0" />
              : <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-slate-300 dark:bg-slate-600" />}
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// Shared classes for the − / + lead-count stepper
const stepBtnCls = 'w-10 h-10 flex items-center justify-center rounded-lg text-ink-2 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-500/10 dark:hover:text-blue-400 transition-colors select-none';
const stepInputCls = 'w-20 h-10 text-center bg-transparent border-0 outline-none font-display text-base font-semibold text-ink tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';
const stepWrapCls = 'inline-flex items-center gap-1 p-1 rounded-xl border border-line bg-white dark:bg-sunken shadow-sm focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10';

// Amber "complete these fields" checklist
function MissingFields({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="w-full bg-amber-50 dark:bg-amber-500/[0.08] border border-amber-200 dark:border-amber-500/20 rounded-xl p-3.5 text-left">
      <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-2 flex items-center gap-1.5">
        <AlertCircle size={14} /> {title}
      </p>
      <div className="space-y-1.5">
        {items.map(it => (
          <p key={it} className="text-xs text-amber-700/90 dark:text-amber-200/90 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" /> {it}
          </p>
        ))}
      </div>
    </div>
  );
}

export default function LeadDiscoveryPage() {
  const qc = useQueryClient();
  const { isSalesUser } = usePermissions();
  const [scanMode, setScanMode] = useState<'service' | 'product' | null>(null);

  // Positions mode — mandatory
  const [positionTitle, setPositionTitle] = useState('');
  const [description, setDescription] = useState('');
  const [geography, setGeography] = useState('');
  const [skillsRequired, setSkillsRequired] = useState('');
  // Which field's "See example" modal is open (null = none).
  const [helpField, setHelpField] = useState<null | 'description' | 'skills'>(null);

  // Positions mode — optional
  const [targetIndustry, setTargetIndustry] = useState('');
  const [companySize, setCompanySize] = useState('');
  const [companyType, setCompanyType] = useState('');
  const [selectedDecisionMakers, setSelectedDecisionMakers] = useState<string[]>([]);
  const [contactChannel, setContactChannel] = useState('');
  const [seniorityLevel, setSeniorityLevel] = useState('');
  const [leadCount, setLeadCount] = useState<number | ''>(1);

  // Products mode — mandatory
  const [productName, setProductName] = useState('');
  const [productGeography, setProductGeography] = useState('');
  const [valueProposition, setValueProposition] = useState('');

  // Products mode — optional
  const [productIndustry, setProductIndustry] = useState('');
  const [productCompanySize, setProductCompanySize] = useState('');
  const [productCompanyType, setProductCompanyType] = useState('');
  const [productDecisionMakers, setProductDecisionMakers] = useState<string[]>([]);
  const [productContactChannel, setProductContactChannel] = useState('');
  const [productSeniorityLevel, setProductSeniorityLevel] = useState('');
  const [productLeadCount, setProductLeadCount] = useState<number | ''>(1);
  const [annualRevenue, setAnnualRevenue] = useState('');

  // Product supplementary inputs
  const [productUrl, setProductUrl] = useState('');
  const [productDocumentText, setProductDocumentText] = useState('');
  const [productFileName, setProductFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AI prompt state
  const [promptText, setPromptText] = useState('');
  const [promptSummary, setPromptSummary] = useState('');
  const [promptBuyerType, setPromptBuyerType] = useState('');
  const [promptGenerated, setPromptGenerated] = useState(false);
  const [promptEdited, setPromptEdited] = useState(false);
  const [smartPrompt, setSmartPrompt] = useState('');

  // Scan state
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [optimisticProgress, setOptimisticProgress] = useState(0);
  const [peakLeadsFound, setPeakLeadsFound] = useState(0);
  

  useEffect(() => {
    const stored = localStorage.getItem(ACTIVE_SCAN_KEY);
    if (stored) setActiveScanId(stored);
  }, []);
  useEffect(() => {
    if (activeScanId) localStorage.setItem(ACTIVE_SCAN_KEY, activeScanId);
    else localStorage.removeItem(ACTIVE_SCAN_KEY);
  }, [activeScanId]);

  // Admin-managed dropdowns (flat array, accessible to all roles)
  const { data: allDropdowns } = useQuery({
    queryKey: ['dropdowns', 'active'],
    queryFn: () => dropdownsApi.listActive().then(r => {
      const raw = r.data.data;
      return Array.isArray(raw) ? raw : [];
    }),
  });

  function getDropdownOptions(category: string, defaults: string[]): string[] {
    if (!allDropdowns || !Array.isArray(allDropdowns)) return defaults;
    // listActive already returns only isActive=true rows
    const items = allDropdowns.filter((d: any) => d.category === category);
    // If DB has no rows for this category yet, fall back to hardcoded defaults
    if (items.length === 0) return defaults;
    // DB has data — show only what's active in the DB (disabled values are excluded)
    return items.map((d: any) => d.value);
  }

  const resourceIndustryOptions       = getDropdownOptions('resource_industry', DEFAULT_INDUSTRIES);
  const resourceCompanySizeOptions    = getDropdownOptions('resource_company_size', DEFAULT_COMPANY_SIZES);
  const resourceCompanyTypeOptions    = getDropdownOptions('resource_company_type', DEFAULT_COMPANY_TYPES);
  const resourceDecisionMakerOptions  = getDropdownOptions('resource_decision_maker', DEFAULT_DECISION_MAKERS);
  const resourceContactChannelOptions = getDropdownOptions('resource_preferred_contact_channel', DEFAULT_CONTACT_CHANNELS);
  const resourceSeniorityOptions      = getDropdownOptions('resource_seniority_level', DEFAULT_SENIORITY_LEVELS);

  const productIndustryOptions        = getDropdownOptions('product_industry', DEFAULT_INDUSTRIES);
  const productCompanySizeOptions     = getDropdownOptions('product_company_size', DEFAULT_COMPANY_SIZES);
  const productCompanyTypeOptions     = getDropdownOptions('product_company_type', DEFAULT_COMPANY_TYPES);
  const productDecisionMakerOptions   = getDropdownOptions('product_decision_maker', DEFAULT_DECISION_MAKERS);
  const productContactChannelOptions  = getDropdownOptions('product_preferred_contact_channel', DEFAULT_CONTACT_CHANNELS);
  const productSeniorityOptions       = getDropdownOptions('product_seniority_level', DEFAULT_SENIORITY_LEVELS);
  const productAnnualRevenueOptions   = getDropdownOptions('product_annual_revenue_range', DEFAULT_ANNUAL_REVENUE);

  // Server-side active scan restore
  const { data: serverActiveScan } = useQuery({
    queryKey: ['activeScan'],
    queryFn: () => discoveryApi.getActiveScan().then(r => r.data.data),
    staleTime: 0, refetchOnWindowFocus: false,
    enabled: !isSalesUser,
  });
  useEffect(() => {
    if (!activeScanId && serverActiveScan?.id) setActiveScanId(serverActiveScan.id);
  }, [serverActiveScan, activeScanId]);

  const { data: scansData } = useQuery({
    queryKey: ['scans'],
    queryFn: () => discoveryApi.getScans().then(r => ({
      items: Array.isArray(r.data.data) ? r.data.data : (r.data.data?.items ?? []),
    })),
    enabled: !isSalesUser,
  });
  const [expandedScan, setExpandedScan] = useState<string | null>(null);

  const { data: quota } = useQuery({
    queryKey: ['lead-quota'],
    queryFn: () => leadsApi.quota().then(r => r.data?.data),
    staleTime: 60000,
  });
  const quotaReached = quota?.used >= quota?.quota;

  // Live poll
  const { data: activeScan } = useQuery({
    queryKey: ['scan', activeScanId],
    queryFn: () => activeScanId
      ? discoveryApi.getScanStatus(activeScanId).then(r => r.data.data)
      : null,
    enabled: !!activeScanId && !isSalesUser,
    refetchInterval: activeScanId ? 2000 : false,
  });

  // Track peak leads count — backend may return 0 in the completed snapshot
  useEffect(() => {
    const count = activeScan?.leadsFound ?? activeScan?.totalLeads ?? activeScan?.leadsCount;
    if (typeof count === 'number' && count > peakLeadsFound) setPeakLeadsFound(count);
  }, [activeScan]);

  useEffect(() => {
    if (activeScan?.status === 'completed' || activeScan?.status === 'failed') {
      const t = setTimeout(() => {
        setActiveScanId(null);
        setOptimisticProgress(0);
        qc.invalidateQueries({ queryKey: ['scans'] });
        qc.invalidateQueries({ queryKey: ['activeScan'] });
      }, 6000);
      return () => clearTimeout(t);
    }
  }, [activeScan?.status]);

  function toggleDecisionMaker(dm: string) {
    setSelectedDecisionMakers(prev => prev.includes(dm) ? prev.filter(r => r !== dm) : [...prev, dm]);
  }
  function toggleProductDecisionMaker(dm: string) {
    setProductDecisionMakers(prev => prev.includes(dm) ? prev.filter(r => r !== dm) : [...prev, dm]);
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setProductFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => setProductDocumentText((ev.target?.result as string) || '');
    reader.readAsText(file);
    toast.success(`"${file.name}" loaded`);
    resetPrompt();
  }

  function resetPrompt() {
    setPromptGenerated(false);
    setPromptText('');
    setPromptSummary('');
    setPromptBuyerType('');
    setPromptEdited(false);
  }

  function startOptimisticProgress() {
    setOptimisticProgress(0);
    setPeakLeadsFound(0);
    let v = 0;
    const iv = setInterval(() => { v += 2; setOptimisticProgress(v); if (v >= 10) clearInterval(iv); }, 600);
  }

  const positionsMandatoryFilled =
    description.trim().length > 0 &&
    geography.trim().length > 0 &&
    skillsRequired.trim().length > 0 &&
    leadCount !== '' && Number(leadCount) >= 1;

  const hasProductInputs =
    productName.trim().length > 0 &&
    productGeography.trim().length > 0 &&
    valueProposition.trim().length > 0;

  const canStartProductScan = promptGenerated && promptText.trim().length > 20;

  const generatePromptMutation = useMutation({
    mutationFn: () => {
      if (!hasProductInputs) throw new Error('Fill in all mandatory fields first');
      return discoveryApi.generateProductPrompt({
        productName: productName.trim(),
        productUrl: productUrl.trim() || undefined,
        productDescription: valueProposition.trim() || undefined,
        productDocumentText: productDocumentText.trim() || undefined,
        targetIndustry: productIndustry && productIndustry !== 'Any Industry' ? productIndustry : undefined,
        targetRegion: productGeography.trim(),
      });
    },
    onSuccess: res => {
      const d = res.data.data;
      setPromptText(d.promptText || '');
      setPromptSummary(d.summary || '');
      setPromptBuyerType(d.buyerType || '');
      setPromptGenerated(true);
      setPromptEdited(false);
      toast.success('Prompt generated — review and edit before scanning');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || err.message || 'Failed to generate prompt');
    },
  });

  const scanMutation = useMutation({
    mutationFn: () => {
      if (!positionsMandatoryFilled) throw new Error('Fill in all mandatory fields');
      return discoveryApi.startScan({
        positionTitle: positionTitle.trim(),
        description: description.trim(),
        geography: geography.trim(),
        skillsRequired: skillsRequired.trim(),
        targetIndustry: targetIndustry && targetIndustry !== 'Any Industry' ? targetIndustry : undefined,
        companySize: companySize && companySize !== 'Any Size' ? companySize : undefined,
        companyType: companyType && companyType !== 'Any' ? companyType : undefined,
        decisionMakers: selectedDecisionMakers.length > 0 ? selectedDecisionMakers : undefined,
        contactChannel: contactChannel && contactChannel !== 'Any' ? contactChannel : undefined,
        seniorityLevel: seniorityLevel && seniorityLevel !== 'Any' ? seniorityLevel : undefined,
        numberOfLeads: Number(leadCount) || 1,
        // Legacy compat
        targetRegion: geography.trim(),
        decisionMakerRoles: selectedDecisionMakers,
        leadCount: Number(leadCount) || 1,
      });
    },
    onSuccess: res => {
      const id = res.data.data.id ?? res.data.data.jobId;
      setActiveScanId(id);
      toast.success('Scan started!');
      qc.invalidateQueries({ queryKey: ['scans'] });
      startOptimisticProgress();
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to start scan'),
  });

  const productScanMutation = useMutation({
    mutationFn: () => {
      const hasUrl = productUrl.trim().length > 0;
      const hasDoc = productDocumentText.trim().length > 5;
      let productType = 'description';
      if (hasUrl) productType = 'url';
      else if (hasDoc) productType = 'document';

      return discoveryApi.startProductScan({
        productName: productName.trim(),
        geography: productGeography.trim(),
        valueProposition: valueProposition.trim(),
        productType,
        productUrl: productUrl.trim() || undefined,
        productDescription: valueProposition.trim() || undefined,
        productDocumentText: productDocumentText.trim() || undefined,
        customPrompt: promptText.trim() || undefined,
        targetIndustry: productIndustry && productIndustry !== 'Any Industry' ? productIndustry : undefined,
        targetRegion: productGeography.trim(),
        companySize: productCompanySize && productCompanySize !== 'Any Size' ? productCompanySize : undefined,
        companyType: productCompanyType && productCompanyType !== 'Any' ? productCompanyType : undefined,
        decisionMakers: productDecisionMakers.length > 0 ? productDecisionMakers : undefined,
        preferredContactChannel: productContactChannel && productContactChannel !== 'Any' ? productContactChannel : undefined,
        seniorityLevel: productSeniorityLevel && productSeniorityLevel !== 'Any' ? productSeniorityLevel : undefined,
        numberOfLeads: Number(productLeadCount) || undefined,
        annualRevenueRange: annualRevenue && annualRevenue !== 'Any' ? annualRevenue : undefined,
      });
    },
    onSuccess: res => {
      const id = res.data.data.id ?? res.data.data.jobId;
      setActiveScanId(id);
      toast.success('Product scan started!');
      qc.invalidateQueries({ queryKey: ['scans'] });
      startOptimisticProgress();
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to start product scan'),
  });
  
  const isMutating = scanMutation.isPending || productScanMutation.isPending || generatePromptMutation.isPending;
  const scanning = isMutating || (!!activeScanId && (activeScan == null || ['running', 'pending'].includes(activeScan?.status)));
  const scanProgress = (activeScan?.progress != null && activeScan.progress > 0) ? activeScan.progress : optimisticProgress;
  const scanComplete = activeScan?.status === 'completed';

  // const smartScanMutation = useMutation({
  //   mutationFn: () => {
  //     if (!smartPrompt.trim()) throw new Error('Enter a prompt first');
  //     return discoveryApi.smartScan(smartPrompt.trim());
  //   },
  //   onSuccess: res => {
  //     const id = res.data.data.id ?? res.data.data.jobId;
  //     setActiveScanId(id);
  //     toast.success('Smart scan started!');
  //     qc.invalidateQueries({ queryKey: ['scans'] });
  //     startOptimisticProgress();
  //   },
  //   onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to start smart scan'),
  // });

  // const smartScanning = smartScanMutation.isPending ||
  //   (!!activeScanId && (activeScan == null || ['running', 'pending'].includes(activeScan?.status)));

  const smartScanMutation = useMutation({
    mutationFn: () => {
      if (!smartPrompt.trim()) throw new Error('Enter a prompt first');
      return discoveryApi.smartScan(smartPrompt.trim());
    },
    onSuccess: res => {
      const id = res.data.data.id ?? res.data.data.jobId;
      setActiveScanId(id);
      toast.success('Smart scan started!');
      qc.invalidateQueries({ queryKey: ['scans'] });
      startOptimisticProgress();
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to start smart scan'),
  });

  const smartScanning = smartScanMutation.isPending ||
    (!!activeScanId && (activeScan == null || ['running', 'pending'].includes(activeScan?.status)));

  // Lead Discovery is not available to sales executives (the API rejects them too)
  if (isSalesUser) {
    return (
      <div className="card p-12 flex flex-col items-center text-center gap-3">
        <div className="w-14 h-14 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center">
          <ShieldOff size={24} />
        </div>
        <h1 className="font-display text-lg font-semibold text-ink">Lead Discovery is not available</h1>
        <p className="text-sm text-ink-3 max-w-sm">Your role doesn&apos;t have access to Lead Discovery. Ask your manager or admin if you need new leads generated.</p>
      </div>
    );
  }

  const quotaPct = quota && Number(quota.quota) > 0
    ? Math.min(100, Math.max(0, (Number(quota.used) / Number(quota.quota)) * 100))
    : 0;

  return (
    <div className="space-y-6">

      {/* Hero */}
      <PageHero
        icon={Radar}
        eyebrow="AI Lead Engine"
        title="Lead Discovery Engine"
        subtitle="What would you like to generate leads for?"
      >
        {quota && quota.quota != null && (
          <div className="rounded-xl bg-white/10 ring-1 ring-white/20 backdrop-blur px-4 py-3 min-w-[220px]">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-100">Leads used</span>
              <span className="font-display text-sm font-semibold text-white tabular-nums">
                {quota.used} <span className="text-blue-200/80 font-medium">/ {quota.quota}</span>
              </span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-white/20 overflow-hidden">
              <div
                className={cn('h-full rounded-full', quotaReached ? 'bg-rose-300' : 'bg-gradient-to-r from-emerald-300 to-cyan-200')}
                style={{ width: `${quotaPct}%` }}
              />
            </div>
          </div>
        )}
      </PageHero>

      {/* Mode dropdown */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          aria-label="Discovery mode"
          value={scanMode ?? ''}
          onChange={e => setScanMode((e.target.value as 'service' | 'product') || null)}
          className="input h-11 text-sm font-medium min-w-[300px] w-auto"
        >
          <option value="">Select discovery mode...</option>
          <option value="service">Find Clients for Services </option>
          <option value="product">Find Customers for Product </option>
        </Select>
        {scanMode && (
          <span className={cn(
            'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold',
            scanMode === 'service'
              ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
              : 'bg-violet-500/10 text-violet-700 dark:text-violet-300'
          )}>
            {scanMode === 'service' ? <Briefcase size={13} /> : <Package size={13} />}
            {scanMode === 'service' ? 'Positions' : 'Products'}
          </span>
        )}
      </div>

      {/* POSITIONS MODE */}
      {scanMode === 'service' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start animate-fade-in">
          <div className="space-y-5">

            <SectionCard title="Position Details" subtitle="Mandatory fields — fill all to enable scanning" icon={FileText} tone="blue">
              <div className="pt-5 space-y-5">
                <div>
                  <MandatoryLabelWithHelp label="Description" onHelp={() => setHelpField('description')} />
                  <textarea className="input text-sm resize-none w-full leading-relaxed" rows={4}
                    placeholder="Enter a detailed description for quality leads"
                    value={description} onChange={e => setDescription(e.target.value)} />
                </div>

                <div>
                  <MandatoryLabel>Geography / Region</MandatoryLabel>
                  <div className="relative">
                    <MapPin size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 z-10" />
                    <input className="input text-sm pl-10" placeholder="e.g. USA, India, UK, Europe"
                      value={geography} onChange={e => setGeography(e.target.value)} />
                  </div>
                </div>

                <div>
                  <MandatoryLabelWithHelp label="Skills / Key Requirements" onHelp={() => setHelpField('skills')} />
                  <textarea className="input text-sm resize-none w-full leading-relaxed" rows={3}
                    placeholder="e.g. SAP S/4HANA, Oracle ERP, 5+ years experience, implementation skills..."
                    value={skillsRequired} onChange={e => setSkillsRequired(e.target.value)} />
                </div>
              </div>
            </SectionCard>

            {helpField === 'description' && (
              <HelpExampleModal
                title="Description — what to enter"
                intro="Describe your offering and your ideal buyer in plain English. The more specific you are about the tech, the customer profile, and the buying-intent phrases, the better the lead quality."
                example={DESCRIPTION_EXAMPLE}
                tips={DESCRIPTION_TIPS}
                onUse={() => setDescription(DESCRIPTION_EXAMPLE)}
                onClose={() => setHelpField(null)}
              />
            )}
            {helpField === 'skills' && (
              <HelpExampleModal
                title="Skills / Key Requirements — what to enter"
                intro="A comma-separated list of the technologies, product names, and keywords that signal a need for your offering. These anchor the search queries and the relevance scoring."
                example={SKILLS_EXAMPLE}
                tips={SKILLS_TIPS}
                onUse={() => setSkillsRequired(SKILLS_EXAMPLE)}
                onClose={() => setHelpField(null)}
              />
            )}

            <SectionCard title="Optional Filters" subtitle="Leave blank for any" defaultOpen={true} icon={SlidersHorizontal} tone="violet">
              <div className="pt-5 space-y-5">

                <div>
                  <p className="label mb-1.5">Industry / Vertical</p>
                  <Select aria-label="Industry" className="input text-sm" value={targetIndustry} onChange={e => setTargetIndustry(e.target.value)}>
                    {resourceIndustryOptions.map(opt => <option key={opt} value={opt === 'Any Industry' ? '' : opt}>{opt}</option>)}
                  </Select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="label mb-1.5">Company Size</p>
                    <Select aria-label="Company size" className="input text-sm" value={companySize} onChange={e => setCompanySize(e.target.value)}>
                      {resourceCompanySizeOptions.map(opt => <option key={opt} value={opt === 'Any Size' ? '' : opt}>{opt}</option>)}
                    </Select>
                  </div>
                  <div>
                    <p className="label mb-1.5">Company Type</p>
                    <Select aria-label="Company type" className="input text-sm" value={companyType} onChange={e => setCompanyType(e.target.value)}>
                      {resourceCompanyTypeOptions.map(opt => <option key={opt} value={opt === 'Any' ? '' : opt}>{opt}</option>)}
                    </Select>
                  </div>
                </div>

                <div>
                  <p className="label mb-2.5">Who approves hiring? (Decision Maker)</p>
                  <ChipSelect
                    options={resourceDecisionMakerOptions}
                    selected={selectedDecisionMakers}
                    onToggle={toggleDecisionMaker}
                    color="violet"
                  />
                  {selectedDecisionMakers.length === 0 && (
                    <p className="text-xs text-ink-3 mt-2.5">No roles selected — Apollo searches for default decision makers</p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="label mb-1.5">Preferred Contact Channel</p>
                    <Select aria-label="Contact channel" className="input text-sm" value={contactChannel} onChange={e => setContactChannel(e.target.value)}>
                      {resourceContactChannelOptions.map(opt => <option key={opt} value={opt === 'Any' ? '' : opt}>{opt}</option>)}
                    </Select>
                  </div>
                  <div>
                    <p className="label mb-1.5">Seniority Level</p>
                    <Select aria-label="Seniority level" className="input text-sm" value={seniorityLevel} onChange={e => setSeniorityLevel(e.target.value)}>
                      {resourceSeniorityOptions.map(opt => <option key={opt} value={opt === 'Any' ? '' : opt}>{opt}</option>)}
                    </Select>
                  </div>
                </div>

                <div>
                  <MandatoryLabel>Number of Leads</MandatoryLabel>
                  <div className={cn(stepWrapCls, 'mt-1')}>
                    <button
                      type="button"
                      aria-label="Decrease lead count"
                      onClick={() => setLeadCount(c => Math.max(1, (Number(c) || 1) - 1))}
                      className={stepBtnCls}
                    ><Minus size={16} /></button>
                    <input
                      type="number"
                      aria-label="Number of leads"
                      min={1}
                      max={500}
                      step={1}
                      value={leadCount}
                      onChange={e => {
                        const raw = e.target.value;
                        if (raw === '') { setLeadCount(''); return; }
                        const val = Number(raw);
                        if (!isNaN(val)) setLeadCount(Math.min(500, val));
                      }}
                      onBlur={() => setLeadCount(c => (c === '' || Number(c) < 1 ? 1 : c))}
                      className={stepInputCls}
                    />
                    <button
                      type="button"
                      aria-label="Increase lead count"
                      onClick={() => setLeadCount(c => Math.min(500, (Number(c) || 0) + 1))}
                      className={stepBtnCls}
                    ><Plus size={16} /></button>
                  </div>
                  {(leadCount === '' || Number(leadCount) < 1) && (
                    <p className="text-xs text-rose-600 dark:text-rose-400 mt-1.5">Number of leads should be at least one.</p>
                  )}
                </div>
              </div>
            </SectionCard>
          </div>

          {/* Right: scan control */}
          <div className="card relative overflow-hidden p-6 flex flex-col min-h-[320px] lg:sticky lg:top-0">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-cyan-400" />
            <div className="pointer-events-none absolute -right-20 -top-20 w-60 h-60 rounded-full bg-blue-500/10 blur-3xl" />
            <div className="relative flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <Radar size={18} />
              </div>
              <h2 className="section-title">Discovery Control</h2>
            </div>
            <div className="relative flex-1 flex flex-col">
              {scanning ? (
                <ScanProgress scanning activeScan={activeScan} scanProgress={scanProgress} color="blue"
                  steps={['AI generates job title variants', 'Google Jobs page 1', 'Google Jobs page 2', 'Google Jobs page 3', 'Filtering agencies', 'More variants', 'Deduplicating', 'Saving leads']} />
              ) : scanComplete ? (
                <ScanComplete activeScan={activeScan} peakLeadsFound={peakLeadsFound} />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-5">
                  <div className="relative">
                    <div className="absolute inset-0 rounded-3xl bg-blue-500/30 blur-xl" />
                    <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500 via-indigo-600 to-violet-600 flex items-center justify-center shadow-xl shadow-indigo-500/30">
                      <Target size={34} className="text-white" />
                    </div>
                  </div>
                  <div>
                    <p className="font-display text-base font-semibold text-ink mb-1.5">Ready to Discover Leads</p>
                    <p className="text-[13px] text-ink-3 max-w-sm leading-relaxed">
                      Google Jobs engine finds companies ACTIVELY HIRING for this position.
                      AI generates job title variants — no static lists.
                      {geography ? ` Targeting ${geography}.` : ' Fill in the mandatory fields to begin.'}
                    </p>
                  </div>
                  {!positionsMandatoryFilled && (
                    <MissingFields
                      title="Complete mandatory fields to scan:"
                      items={[
                        ...(!description.trim() ? ['Description'] : []),
                        ...(!geography.trim() ? ['Geography'] : []),
                        ...(!skillsRequired.trim() ? ['Skills / Key Requirements'] : []),
                      ]}
                    />
                  )}
                  <button className="btn-primary px-8 py-3.5 text-sm w-full justify-center"
                    onClick={() => scanMutation.mutate()}
                    disabled={scanMutation.isPending || quotaReached}
                    title={quotaReached ? 'Lead quota reached' : ''}
                  >
                    {scanMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                    Generate Leads
                  </button>
                  {quotaReached && (
                    <p className="text-xs text-rose-600 dark:text-rose-400">Lead quota reached. Upgrade plan to discover more.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PRODUCTS MODE */}
      {scanMode === 'product' && (
        <div className="space-y-5 animate-fade-in">

          {/* Stepper */}
          <div className="card p-2 flex flex-col sm:flex-row sm:items-center gap-1">
            {[
              { n: '1', label: 'Enter product info', done: hasProductInputs, active: !hasProductInputs },
              { n: '2', label: 'Review AI prompt', done: promptGenerated, active: hasProductInputs && !promptGenerated },
              { n: '3', label: 'Start scan', done: false, active: promptGenerated && !scanning },
            ].map(({ n, label, done, active }, i) => (
              <div key={n} className="flex items-center gap-1 flex-1 min-w-0">
                <div className={cn(
                  'flex items-center gap-3 flex-1 min-w-0 px-3 py-2.5 rounded-xl transition-colors',
                  active ? 'bg-violet-500/[0.08]' : done ? 'bg-emerald-500/[0.06]' : ''
                )}>
                  <div className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                    done ? 'bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-md shadow-emerald-500/30'
                      : active ? 'bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-md shadow-violet-500/30'
                        : 'bg-slate-100 dark:bg-white/[0.05] text-ink-3'
                  )}>
                    {done ? <Check size={15} /> : n}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">Step {n}</p>
                    <p className={cn('text-[13px] font-semibold truncate',
                      done ? 'text-emerald-600 dark:text-emerald-400' : active ? 'text-ink' : 'text-ink-3')}>
                      {label}
                    </p>
                  </div>
                </div>
                {i < 2 && <ChevronRight size={16} className="hidden sm:block text-slate-300 dark:text-slate-600 flex-shrink-0" />}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            <div className="space-y-5">

              <SectionCard title="Product Details" subtitle="Mandatory fields — fill all to enable scanning" icon={Package} tone="violet">
                <div className="pt-5 space-y-5">
                  <p className="text-[11px] text-ink-3 flex items-center gap-1">
                    <span className="text-rose-500 font-bold">*</span> Required fields
                  </p>

                  <div>
                    <MandatoryLabel>Product Name / Category</MandatoryLabel>
                    <input className="input text-sm"
                      placeholder="e.g. CRM Software, Industrial Pump, LED Display Board"
                      value={productName}
                      onChange={e => { setProductName(e.target.value); resetPrompt(); }} />
                  </div>

                  <div>
                    <MandatoryLabel>Geography / Region</MandatoryLabel>
                    <div className="relative">
                      <MapPin size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 z-10" />
                      <input className="input text-sm pl-10" placeholder="e.g. USA, India, UK, Europe"
                        value={productGeography}
                        onChange={e => { setProductGeography(e.target.value); resetPrompt(); }} />
                    </div>
                  </div>

                  <div>
                    <MandatoryLabel>Value Proposition / Key Benefit</MandatoryLabel>
                    <textarea className="input text-sm resize-none w-full leading-relaxed" rows={4}
                      placeholder="Please enter a detailed description — what problem does your product solve? Who needs it? What results does it deliver?"
                      value={valueProposition}
                      onChange={e => { setValueProposition(e.target.value); resetPrompt(); }} />
                    <p className="text-[11px] text-ink-3 mt-1.5 text-right tabular-nums">{valueProposition.length}/3000 chars</p>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Additional Product Information" subtitle="Optional — helps AI build a better targeting prompt" defaultOpen={false} icon={Link2} tone="cyan">
                <div className="pt-5 space-y-6">
                  <div>
                    <div className="flex items-center gap-2 mb-2.5">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
                        <Link2 size={15} />
                      </div>
                      <p className="text-sm font-semibold text-ink">Product URL</p>
                      <span className="text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/[0.05] text-ink-3">OPTIONAL</span>
                    </div>
                    <div className="flex gap-2">
                      <input className="input text-sm flex-1" placeholder="https://yourproduct.com"
                        value={productUrl} onChange={e => { setProductUrl(e.target.value); resetPrompt(); }} />
                      {productUrl && (
                        <a href={productUrl} target="_blank" rel="noreferrer" title="Open product URL" className="btn-ghost flex-shrink-0 px-3">
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                    <p className="text-xs text-ink-3 mt-1.5">AI fetches the page to understand what you offer</p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-slate-200 dark:bg-white/[0.06]" />
                    <span className="text-[10px] font-bold tracking-[0.14em] px-2.5 py-1 rounded-full bg-slate-100 dark:bg-white/[0.05] text-ink-3">AND / OR</span>
                    <div className="flex-1 h-px bg-slate-200 dark:bg-white/[0.06]" />
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-2.5">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
                        <FileText size={15} />
                      </div>
                      <p className="text-sm font-semibold text-ink">Upload Brochure / Spec Sheet</p>
                      <span className="text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/[0.05] text-ink-3">OPTIONAL</span>
                    </div>
                    <input ref={fileInputRef} type="file" accept=".txt,.md,.csv,.pdf"
                      onChange={handleFileUpload} className="hidden" aria-label="Upload brochure or spec sheet" />
                    {productDocumentText ? (
                      <div className="rounded-xl p-3.5 border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/60 dark:bg-emerald-500/[0.06]">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" />
                            <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold truncate">{productFileName}</span>
                          </div>
                          <button onClick={() => { setProductDocumentText(''); setProductFileName(''); resetPrompt(); }}
                            aria-label="Remove uploaded file"
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-3 hover:text-rose-600 hover:bg-rose-500/10 transition-colors">
                            <X size={13} />
                          </button>
                        </div>
                        <p className="text-xs text-ink-2 line-clamp-2">{productDocumentText.slice(0, 180)}...</p>
                      </div>
                    ) : (
                      <button type="button" onClick={() => fileInputRef.current?.click()}
                        className="w-full border-2 border-dashed border-slate-300 dark:border-white/[0.10] hover:border-emerald-400 dark:hover:border-emerald-500/40 hover:bg-emerald-50/50 dark:hover:bg-emerald-500/[0.04] rounded-2xl p-6 text-center transition-all group">
                        <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center group-hover:scale-105 transition-transform">
                          <Upload size={20} />
                        </div>
                        <p className="text-sm font-medium text-ink">Click to upload .txt, .md, or .pdf</p>
                        <p className="text-xs text-ink-3 mt-1">Max 5 MB</p>
                      </button>
                    )}
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Optional Filters" subtitle="Narrow down your target audience" defaultOpen={true} icon={SlidersHorizontal} tone="violet">
                <div className="pt-5 space-y-5">

                  <div>
                    <p className="label mb-1.5">Industry / Vertical</p>
                    <Select aria-label="Industry" className="input text-sm" value={productIndustry}
                      onChange={e => { setProductIndustry(e.target.value); resetPrompt(); }}>
                      {productIndustryOptions.map(opt => <option key={opt} value={opt === 'Any Industry' ? '' : opt}>{opt}</option>)}
                    </Select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <p className="label mb-1.5">Company Size</p>
                      <Select aria-label="Company size" className="input text-sm" value={productCompanySize} onChange={e => setProductCompanySize(e.target.value)}>
                        {productCompanySizeOptions.map(opt => <option key={opt} value={opt === 'Any Size' ? '' : opt}>{opt}</option>)}
                      </Select>
                    </div>
                    <div>
                      <p className="label mb-1.5">Company Type</p>
                      <Select aria-label="Company type" className="input text-sm" value={productCompanyType} onChange={e => setProductCompanyType(e.target.value)}>
                        {productCompanyTypeOptions.map(opt => <option key={opt} value={opt === 'Any' ? '' : opt}>{opt}</option>)}
                      </Select>
                    </div>
                  </div>

                  <div>
                    <p className="label mb-1.5">Annual Revenue Range (USD)</p>
                    <Select
                      aria-label="Annual revenue range"
                      className="input text-sm w-full"
                      value={annualRevenue}
                      onChange={e => setAnnualRevenue(e.target.value)}
                    >
                      {productAnnualRevenueOptions.map(opt => (
                        <option key={opt} value={opt === 'Any' ? '' : opt}>{opt}</option>
                      ))}
                    </Select>
                  </div>

                  <div>
                    <p className="label mb-2.5">Who makes the buying decision?</p>
                    <ChipSelect
                      options={productDecisionMakerOptions}
                      selected={productDecisionMakers}
                      onToggle={toggleProductDecisionMaker}
                      color="violet"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <p className="label mb-1.5">Preferred Contact Channel</p>
                      <Select aria-label="Contact channel" className="input text-sm" value={productContactChannel} onChange={e => setProductContactChannel(e.target.value)}>
                        {productContactChannelOptions.map(opt => <option key={opt} value={opt === 'Any' ? '' : opt}>{opt}</option>)}
                      </Select>
                    </div>
                    <div>
                      <p className="label mb-1.5">Seniority Level</p>
                      <Select aria-label="Seniority level" className="input text-sm" value={productSeniorityLevel} onChange={e => setProductSeniorityLevel(e.target.value)}>
                        {productSeniorityOptions.map(opt => <option key={opt} value={opt === 'Any' ? '' : opt}>{opt}</option>)}
                      </Select>
                    </div>
                  </div>

                  <div>
                    <p className="label mb-2 flex items-center">Number of Leads to Generate
                      <span className="ml-2 text-[10px] font-semibold normal-case tracking-normal px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/[0.05] text-ink-3">optional</span>
                    </p>
                    <div className={cn(stepWrapCls, 'mt-1')}>
                      <button
                        type="button"
                        aria-label="Decrease lead count"
                        onClick={() => setProductLeadCount(c => Math.max(1, (Number(c) || 1) - 1))}
                        className={stepBtnCls}
                      ><Minus size={16} /></button>
                      <input
                        type="number"
                        aria-label="Number of leads"
                        min={1}
                        max={500}
                        step={1}
                        value={productLeadCount}
                        onChange={e => {
                          const raw = e.target.value;
                          if (raw === '') { setProductLeadCount(''); return; }
                          const val = Number(raw);
                          if (!isNaN(val)) setProductLeadCount(Math.min(500, val));
                        }}
                        onBlur={() => setProductLeadCount(c => (c === '' || Number(c) < 1 ? 1 : c))}
                        className={stepInputCls}
                      />
                      <button
                        type="button"
                        aria-label="Increase lead count"
                        onClick={() => setProductLeadCount(c => Math.min(500, (Number(c) || 0) + 1))}
                        className={stepBtnCls}
                      ><Plus size={16} /></button>
                    </div>
                    {(productLeadCount === '' || Number(productLeadCount) < 1) && (
                      <p className="text-xs text-rose-600 dark:text-rose-400 mt-1.5">Number of leads should be at least one.</p>
                    )}
                  </div>
                </div>
              </SectionCard>

              {!promptGenerated && (
                <>
                  <button
                    className="btn-primary w-full py-3.5 text-sm justify-center"
                    onClick={() => generatePromptMutation.mutate()}
                    disabled={!hasProductInputs || generatePromptMutation.isPending}>
                    {generatePromptMutation.isPending
                      ? <><Loader2 size={15} className="animate-spin" /> AI analyzing your product...</>
                      : <><Sparkles size={15} /> Generate Discovery Prompt</>}
                  </button>
                  {!hasProductInputs && (
                    <MissingFields
                      title="Complete mandatory fields first:"
                      items={[
                        ...(!productName.trim() ? ['Product Name / Category'] : []),
                        ...(!productGeography.trim() ? ['Geography / Region'] : []),
                        ...(!valueProposition.trim() ? ['Value Proposition'] : []),
                      ]}
                    />
                  )}
                </>
              )}
            </div>

            <div className="space-y-5 lg:sticky lg:top-0">
              {(scanning || scanComplete) && (
                <div className="card relative overflow-hidden p-6">
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-400" />
                  <div className="flex items-center gap-3 mb-5">
                    <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center',
                      scanComplete ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-violet-500/10 text-violet-600 dark:text-violet-400')}>
                      {scanComplete ? <CheckCircle2 size={18} /> : <Radar size={18} />}
                    </div>
                    <h2 className="section-title">
                      {scanComplete ? 'Scan Complete' : 'Product Scan in Progress'}
                    </h2>
                  </div>
                  {scanComplete ? (
                    <ScanComplete activeScan={activeScan} peakLeadsFound={peakLeadsFound} />
                  ) : (
                    <ScanProgress scanning activeScan={activeScan} scanProgress={scanProgress} color="violet"
                      steps={['AI call — analyzing product', 'AI batch scoring', 'Filtering competitors', 'Deduplicating', 'Saving leads']} />
                  )}
                </div>
              )}

              {promptGenerated && !scanning && !scanComplete && (
                <div className="card relative overflow-hidden p-5 space-y-4">
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-400" />
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 flex items-center justify-center flex-shrink-0">
                        <Sparkles size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h2 className="section-title">AI Discovery Prompt</h2>
                          <span className={cn(
                            'text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-md',
                            promptEdited
                              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                              : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          )}>
                            {promptEdited ? 'EDITED' : 'AI GENERATED'}
                          </span>
                          {promptBuyerType && (
                            <span className={cn(
                              'text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-md',
                              promptBuyerType === 'B2B' ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
                                : promptBuyerType === 'B2C' ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300'
                                  : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                            )}>
                              {promptBuyerType}
                            </span>
                          )}
                        </div>
                        {promptSummary && <p className="text-xs text-ink-3 leading-relaxed">{promptSummary}</p>}
                      </div>
                    </div>
                    <button
                      className="btn-ghost text-xs py-1.5 px-2.5 flex items-center gap-1.5 flex-shrink-0"
                      onClick={() => generatePromptMutation.mutate()}
                      disabled={generatePromptMutation.isPending}
                      title="Regenerate">
                      <RotateCcw size={12} className={generatePromptMutation.isPending ? 'animate-spin' : ''} />
                      Regenerate
                    </button>
                  </div>

                  <div className="relative">
                    <textarea
                      className="input text-xs leading-relaxed resize-none w-full font-mono"
                      rows={18}
                      value={promptText}
                      onChange={e => { setPromptText(e.target.value); setPromptEdited(true); }}
                      placeholder="AI prompt will appear here..."
                    />
                    <div className="absolute top-2.5 right-2.5 flex items-center gap-1 rounded-md px-2 py-1 pointer-events-none bg-violet-500/10 text-violet-700 dark:text-violet-300">
                      <Edit3 size={10} />
                      <span className="text-[10px] font-semibold">editable</span>
                    </div>
                  </div>

                  <p className="text-xs text-ink-3 leading-relaxed">
                    Review the targeting strategy above. Edit any part — add industries, keywords, change job titles.
                    The scan will use exactly what you see here.
                  </p>

                  <button
                    className="btn-primary w-full py-3.5 text-sm justify-center"
                    onClick={() => productScanMutation.mutate()}
                    disabled={!canStartProductScan || productScanMutation.isPending || quotaReached}
                    title={quotaReached ? 'Lead quota reached' : ''}
                  >
                    {productScanMutation.isPending
                      ? <><Loader2 size={15} className="animate-spin" /> Starting scan...</>
                      : <><Zap size={15} /> Generate Leads</>}
                  </button>
                  {quotaReached && (
                    <p className="text-xs text-rose-600 dark:text-rose-400 text-center mt-2">Lead quota reached. Upgrade plan to discover more.</p>
                  )}
                </div>
              )}

              {!promptGenerated && !scanning && !scanComplete && (
                <div className="card relative overflow-hidden p-6 flex flex-col items-center justify-center text-center gap-5 min-h-[300px]">
                  <div className="pointer-events-none absolute -right-20 -top-20 w-60 h-60 rounded-full bg-violet-500/10 blur-3xl" />
                  <div className="relative">
                    <div className="absolute inset-0 rounded-3xl bg-violet-500/30 blur-xl" />
                    <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-600 to-indigo-600 flex items-center justify-center shadow-xl shadow-violet-500/30">
                      <Sparkles size={28} className="text-white" />
                    </div>
                  </div>
                  <div className="relative">
                    <p className="font-display text-base font-semibold text-ink mb-1.5">AI Prompt Preview</p>
                    <p className="text-[13px] text-ink-3 max-w-sm leading-relaxed">
                      Fill in the mandatory product details, then click{' '}
                      <span className="text-violet-600 dark:text-violet-400 font-semibold">Generate Discovery Prompt</span>.
                      AI will build a targeting strategy you can review and edit before scanning.
                    </p>
                  </div>
                  <div className="relative space-y-2 w-full text-left">
                    {[
                      { icon: Target, text: 'Identifies who NEEDS your product', cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
                      { icon: Search, text: 'Generates search keywords & queries', cls: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' },
                      { icon: Edit3, text: 'You review & edit before scanning', cls: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
                      { icon: Rocket, text: 'Scan runs with your approved prompt', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
                    ].map(({ icon: Icon, text, cls }) => (
                      <div key={text} className="flex items-center gap-3 rounded-xl px-3 py-2.5 border border-line bg-white/70 dark:bg-white/[0.02]">
                        <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', cls)}>
                          <Icon size={15} />
                        </span>
                        <p className="text-[13px] font-medium text-ink-2">{text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Scan History */}
      {(scansData?.items?.length ?? 0) > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <History size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="section-title">Scan History</h2>
              <p className="text-xs text-ink-3 mt-0.5">Your most recent discovery runs</p>
            </div>
          </div>
          <div className="space-y-2.5">
            {(scansData!.items as any[]).slice(0, 8).map((scan: any) => {
              const isProduct = scan.sources?.scanType === 'product';
              const expanded = expandedScan === scan.id;
              return (
                <div key={scan.id} className={cn(
                  'relative rounded-xl border overflow-hidden transition-all duration-150',
                  expanded
                    ? 'border-indigo-200 dark:border-indigo-500/25 bg-slate-50/80 dark:bg-white/[0.02] shadow-sm'
                    : 'border-line bg-white dark:bg-surface-2 hover:border-slate-300 dark:hover:border-white/[0.15]'
                )}>
                  <span className={cn('absolute left-0 top-0 bottom-0 w-[3px]',
                    scan.status === 'completed' ? 'bg-emerald-500'
                      : scan.status === 'running' ? 'bg-blue-500'
                        : scan.status === 'failed' ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-600')} />
                  <button
                    type="button"
                    onClick={() => setExpandedScan(expanded ? null : scan.id)}
                    aria-expanded={expanded}
                    className="w-full flex items-center justify-between pl-4 pr-3 py-3 gap-3 text-left"
                  >
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <ChevronDown className={cn('w-4 h-4 text-ink-3 flex-shrink-0 transition-transform duration-200', expanded && 'rotate-180')} />
                      <Badge color={
                        scan.status === 'completed' ? 'green' :
                          scan.status === 'running' ? 'blue' :
                            scan.status === 'failed' ? 'red' : 'gray'
                      }>{scan.status}</Badge>
                      <span className={cn('text-[11px] font-semibold rounded-md px-2 py-0.5',
                        isProduct ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300'
                          : 'bg-blue-500/10 text-blue-700 dark:text-blue-300')}>
                        {isProduct ? 'product' : 'positions'}
                      </span>
                      <span className="text-sm font-semibold text-ink tabular-nums">{scan.leadsFound ?? 0} leads</span>
                      {(scan.geography || scan.targetRegion) && (
                        <span className="inline-flex items-center gap-1 text-xs text-ink-3">
                          <MapPin size={11} /> {scan.geography || scan.targetRegion}
                        </span>
                      )}
                      {scan.avgMatchScore != null && (
                        <span className={cn(
                          'text-[11px] font-semibold px-2 py-0.5 rounded-full',
                          scan.avgMatchScore >= 80 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' :
                            scan.avgMatchScore >= 50 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' :
                              'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                        )}>
                          {scan.avgMatchScore}% match
                        </span>
                      )}
                      {!isProduct && (scan.positionTitle || (scan.services ?? []).length > 0) && (
                        <span className="text-xs text-ink-3 truncate hidden sm:inline">
                          · {scan.positionTitle || (scan.services as string[]).slice(0, 2).join(', ')}
                        </span>
                      )}
                      {isProduct && (scan.sources?.productName || scan.sources?.productDescriptionSnippet) && (
                        <span className="text-xs text-ink-3 truncate hidden sm:inline">
                          · {scan.sources.productName || scan.sources.productDescriptionSnippet?.slice(0, 50)}
                        </span>
                      )}
                      {scan.keyword && (
                        <span className="text-[11px] font-medium rounded-md px-2 py-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 truncate max-w-[220px]" title={scan.keyword}>
                          {scan.keyword}
                        </span>
                      )}
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-xs text-ink-3 flex-shrink-0">
                      <Calendar size={12} /> {formatDate(scan.createdAt)}
                    </span>
                  </button>
                  {expanded && (
                    <div className="pl-4 pr-3 pb-3 space-y-2.5">
                      <ScanActivityPanel scanId={scan.id} />
                      <ScanLeadsPanel scanId={scan.id} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function cn2(...cls: (string | boolean | undefined | null)[]) {
  return cls.filter(Boolean).join(' ');
}

type ScanEvent = {
  ts: number;
  type: 'kept' | 'filtered' | 'phase';
  reason?: string;
  company?: string;
  source?: string;
  detail?: string;
  count?: number;
};

const FILTER_REASON_LABEL: Record<string, string> = {
  aggregator:   'aggregator / job board',
  vendor:       'platform vendor',
  competitor:   'competitor',
  seller:       'seller (not a buyer)',
  agency:       'staffing agency',
  'below-score': 'below score threshold',
  duplicate:    'already saved (duplicate)',
};

function ScanActivity({ events }: { events: ScanEvent[] }) {
  const [open, setOpen] = useState(false);

  // Latest events at the top — the feed is more useful reverse-chronological.
  const ordered = [...events].reverse();
  const kept = events.filter(e => e.type === 'kept').length;
  const filtered = events.filter(e => e.type === 'filtered').length;

  if (!events.length) return null;

  return (
    <div className="rounded-xl border border-line overflow-hidden bg-white dark:bg-surface">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-xs bg-slate-50 dark:bg-white/[0.03] hover:bg-slate-100 dark:hover:bg-white/[0.05] transition-colors"
      >
        <ChevronDown size={13} className={cn2('text-ink-3 transition-transform duration-200', open && 'rotate-180')} />
        <span className="font-semibold text-ink">Activity</span>
        <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold">
          <Check size={11} /> {kept} kept
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold">
          <X size={11} /> {filtered} filtered
        </span>
      </button>
      {open && (
        <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-white/[0.04]">
          {ordered.map((e, i) => {
            if (e.type === 'phase') {
              return (
                <div key={i} className="px-3 py-1.5 text-[11px] text-ink-3 italic bg-slate-50/60 dark:bg-white/[0.015]">
                  {e.reason === 'scoring-start' ? `AI scoring ${e.count ?? ''} companies…` : e.reason}
                </div>
              );
            }
            const isKept = e.type === 'kept';
            return (
              <div key={i} className="px-3 py-2 flex items-start gap-2 text-[11px]">
                <span className={cn2(
                  'mt-px w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0',
                  isKept ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                )}>
                  {isKept ? <Check size={10} /> : <X size={10} />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className={cn2('font-semibold truncate', isKept ? 'text-ink' : 'text-ink-2')}>
                      {e.company || '(unknown)'}
                    </span>
                    {e.source && (
                      <span className="text-ink-3">· {e.source}</span>
                    )}
                    {!isKept && (
                      <span className="text-amber-600 dark:text-amber-400">
                        · {FILTER_REASON_LABEL[e.reason || ''] || e.reason || 'filtered'}
                      </span>
                    )}
                  </div>
                  {!isKept && e.detail && (
                    <div className="text-ink-3 mt-0.5 line-clamp-2">{e.detail}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Literal class strings per accent so Tailwind generates them.
const PROGRESS_TONES: Record<string, { box: string; dot: string; title: string; pct: string; bar: string; step: string; ring: string }> = {
  blue: {
    box: 'bg-gradient-to-br from-blue-50 to-indigo-50/50 dark:from-blue-500/[0.10] dark:to-indigo-500/[0.04] border-blue-200 dark:border-blue-500/20',
    dot: 'bg-blue-500',
    title: 'text-blue-700 dark:text-blue-300',
    pct: 'text-blue-700 dark:text-blue-300',
    bar: 'from-blue-500 via-indigo-500 to-cyan-400',
    step: 'text-blue-700 dark:text-blue-300',
    ring: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  },
  violet: {
    box: 'bg-gradient-to-br from-violet-50 to-fuchsia-50/50 dark:from-violet-500/[0.10] dark:to-fuchsia-500/[0.04] border-violet-200 dark:border-violet-500/20',
    dot: 'bg-violet-500',
    title: 'text-violet-700 dark:text-violet-300',
    pct: 'text-violet-700 dark:text-violet-300',
    bar: 'from-violet-500 via-fuchsia-500 to-indigo-400',
    step: 'text-violet-700 dark:text-violet-300',
    ring: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  },
};

function ScanProgress({ activeScan, scanProgress, steps, color = 'blue' }: {
  activeScan: any; scanProgress: number; steps: string[]; scanning?: boolean; color?: string;
}) {
  const events: ScanEvent[] = Array.isArray(activeScan?.events) ? activeScan.events : [];
  const t = PROGRESS_TONES[color] ?? PROGRESS_TONES.blue;
  return (
    <div className="space-y-4">
      <div className={cn2('p-4 border rounded-2xl', t.box)}>
        <div className="flex items-center gap-2 mb-3">
          <span className="relative flex w-2.5 h-2.5">
            <span className={cn2('absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping', t.dot)} />
            <span className={cn2('relative inline-flex w-2.5 h-2.5 rounded-full', t.dot)} />
          </span>
          <span className={cn2('text-sm font-semibold', t.title)}>
            {color === 'violet' ? 'Finding buyer companies...' : 'Scanning for leads...'}
          </span>
          <span className={cn2('ml-auto font-display text-lg font-semibold tabular-nums', t.pct)}>{scanProgress}%</span>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden bg-white/80 dark:bg-white/[0.06] ring-1 ring-black/[0.03] dark:ring-0">
          <div
            className={cn2('h-full rounded-full bg-gradient-to-r transition-all duration-700', t.bar)}
            style={{ width: `${Math.min(100, Math.round(scanProgress))}%` }}
          />
        </div>
        <p className="text-xs text-ink-2 mt-2.5">
          <span className="font-display text-sm font-semibold text-ink tabular-nums">{activeScan?.leadsFound ?? 0}</span> leads found so far
        </p>
      </div>
      <ol className="space-y-1">
        {steps.map((step, i) => {
          const threshold = (i + 1) / steps.length * 100;
          const done = scanProgress >= threshold;
          const active = !done && scanProgress >= threshold - (100 / steps.length);
          return (
            <li key={i} className={cn2(
              'flex items-center gap-2.5 text-xs px-2 py-1.5 rounded-lg transition-all',
              done ? 'text-emerald-600 dark:text-emerald-400'
                : active ? cn2(t.step, 'font-semibold bg-slate-50 dark:bg-white/[0.03]')
                  : 'text-ink-3'
            )}>
              <span className={cn2(
                'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0',
                done ? 'bg-emerald-500/15' : active ? t.ring : 'bg-slate-100 dark:bg-white/[0.04]'
              )}>
                {done ? <Check size={11} />
                  : active ? <Loader2 size={11} className="animate-spin" />
                    : <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />}
              </span>
              {step}
            </li>
          );
        })}
      </ol>
      <ScanActivity events={events} />
      <p className="text-xs text-ink-3 text-center flex items-center justify-center gap-1.5">
        <CheckCircle2 size={12} className="text-emerald-500" /> Progress saved — safe to navigate away
      </p>
    </div>
  );
}

function ScanComplete({ activeScan, peakLeadsFound = 0 }: { activeScan: any; peakLeadsFound?: number }) {
  const leadsFound = activeScan?.leadsFound || activeScan?.totalLeads || activeScan?.leadsCount || peakLeadsFound;
  return (
    <div className="flex flex-col items-center justify-center text-center gap-5 py-4">
      <div className="relative">
        <div className="absolute inset-0 rounded-3xl bg-emerald-500/30 blur-xl" />
        <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center shadow-xl shadow-emerald-500/30">
          <CheckCircle2 size={36} className="text-white" />
        </div>
      </div>
      <div>
        <p className="font-display text-base font-semibold text-ink mb-2">Scan Complete!</p>
        <p className="font-display text-5xl font-semibold tracking-[-0.04em] bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent tabular-nums">{leadsFound}</p>
        <p className="text-sm text-ink-3 mt-1">new leads discovered</p>
      </div>
      <a href="/dashboard/leads" className="btn-primary text-sm px-6 py-3 w-full justify-center">
        <Users size={15} /> View All Leads <ArrowRight size={14} />
      </a>
    </div>
  );
}
