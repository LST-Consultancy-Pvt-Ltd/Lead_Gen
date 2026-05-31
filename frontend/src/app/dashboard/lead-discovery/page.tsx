'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit3,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  RotateCcw,
  Sparkles,
  Target,
  Upload,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { discoveryApi, dropdownsApi, leadsApi } from '../../../lib/api';
import { Badge, ProgressBar } from '../../../components/ui';
import { formatDate } from '../../../lib/utils';

const ACTIVE_SCAN_KEY = 'lf_active_scan_id';

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
  'Any Size',
  '1-10 (Micro)',
  '11-50 (Small)',
  '51-200 (Mid-size)',
  '201-500 (Growing)',
  '501-1000 (Large)',
  '1000-5000 (Enterprise)',
  '5000+ (Global Enterprise)',
];

const DEFAULT_COMPANY_TYPES = [
  'Any',
  'Private Limited',
  'Public Listed',
  'Startup',
  'MNC',
  'SME',
  'Government / PSU',
  'NGO / Non-profit',
  'Partnership Firm',
  'LLP',
  'Sole Proprietorship',
  'Family Business',
];

const DEFAULT_DECISION_MAKERS = [
  'CEO / Founder',
  'CTO / CIO',
  'CFO',
  'CMO',
  'COO',
  'MD / Director',
  'VP Sales',
  'VP Operations',
  'Head of HR',
  'Talent Acquisition Manager',
  'Procurement Head',
  'Facilities Lead',
  'Department Head',
  'Board Member',
];

const DEFAULT_CONTACT_CHANNELS = [
  'Any',
  'Email',
  'LinkedIn',
  'Phone / Call',
  'WhatsApp',
  'In-person / Visit',
];

const DEFAULT_SENIORITY_LEVELS = [
  'Any',
  'C-suite',
  'VP / SVP Level',
  'Director Level',
  'Manager Level',
  'Team Lead',
  'Individual Contributor',
  'Board / Advisor Level',
];

const DEFAULT_ANNUAL_REVENUE = [
  'Any',
  'Under $1M',
  '$1M - $5M',
  '$5M - $10M',
  '$10M - $25M',
  '$25M - $50M',
  '$50M - $100M',
  '$100M - $250M',
  '$250M - $500M',
  '$500M - $1B',
  'Above $1B',
];

type ScanMode = 'service' | 'product';
type StrategyPreview = {
  buyerIndustries: string[];
  buyerPersonas: string[];
  demandSignals: string[];
  searchPlan: string[];
  exclusions: string[];
  expectedQuality: string;
};
type PromptState = {
  text: string;
  summary: string;
  buyerType: string;
  searchStrategy: string;
  generated: boolean;
  edited: boolean;
  strategy: StrategyPreview;
};

function emptyStrategy(): StrategyPreview {
  return {
    buyerIndustries: [],
    buyerPersonas: [],
    demandSignals: [],
    searchPlan: [],
    exclusions: [],
    expectedQuality: '',
  };
}

function cn(...cls: (string | boolean | undefined | null)[]) {
  return cls.filter(Boolean).join(' ');
}

function emptyPrompt(): PromptState {
  return {
    text: '',
    summary: '',
    buyerType: '',
    searchStrategy: '',
    generated: false,
    edited: false,
    strategy: emptyStrategy(),
  };
}

function SectionCard({
  title,
  subtitle,
  defaultOpen = true,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-200/20 dark:hover:bg-slate-800/20 transition-colors text-left"
      >
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {open ? (
          <ChevronUp size={14} className="text-slate-500 flex-shrink-0" />
        ) : (
          <ChevronDown size={14} className="text-slate-500 flex-shrink-0" />
        )}
      </button>
      {open && <div className="px-5 pb-5 border-t border-slate-200 dark:border-white/[0.04]">{children}</div>}
    </div>
  );
}

function MandatoryLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="label mb-1.5 flex items-center gap-1">
      {children}
      <span className="text-red-400 text-xs font-bold">*</span>
    </p>
  );
}

function ChipSelect({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(option => {
        const active = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            onClick={() => onToggle(option)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
              active
                ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                : 'bg-slate-100 dark:bg-slate-950 border-slate-200 dark:border-white/[0.06] text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:border-slate-400 dark:hover:border-white/20'
            )}
          >
            <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', active ? 'bg-violet-400' : 'bg-slate-500')} />
            {option}
          </button>
        );
      })}
    </div>
  );
}

function ModeButton({
  active,
  title,
  subtitle,
  onClick,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-2xl border px-4 py-3 text-left transition-all',
        active
          ? 'border-blue-500/30 bg-blue-500/10 shadow-[0_0_0_1px_rgba(59,130,246,0.15)]'
          : 'border-slate-200 dark:border-white/[0.06] bg-white/60 dark:bg-slate-950 hover:border-slate-300 dark:hover:border-white/20'
      )}
    >
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</p>
      <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
    </button>
  );
}

function StepRail({
  steps,
}: {
  steps: Array<{ n: string; label: string; done: boolean; active: boolean }>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {steps.map((step, index) => (
        <div key={step.n} className="flex items-center gap-2">
          <div
            className={cn(
              'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
              step.done
                ? 'bg-emerald-500/20 text-emerald-400'
                : step.active
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-600'
            )}
          >
            {step.done ? '✓' : step.n}
          </div>
          <span
            className={cn(
              'text-xs font-medium',
              step.done
                ? 'text-emerald-400'
                : step.active
                  ? 'text-slate-800 dark:text-slate-200'
                  : 'text-slate-500'
            )}
          >
            {step.label}
          </span>
          {index < steps.length - 1 && <ArrowRight size={12} className="text-slate-500" />}
        </div>
      ))}
    </div>
  );
}

function StrategyChips({ label, items, tone = 'slate' }: { label: string; items: string[]; tone?: 'slate' | 'emerald' | 'violet' | 'amber' | 'rose' }) {
  if (!items.length) return null;
  const toneClass =
    tone === 'emerald' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
    : tone === 'violet' ? 'bg-violet-500/10 text-violet-300 border-violet-500/20'
    : tone === 'amber' ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
    : tone === 'rose' ? 'bg-rose-500/10 text-rose-300 border-rose-500/20'
    : 'bg-slate-500/10 text-slate-300 border-slate-500/20';
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, idx) => (
          <span key={`${label}-${idx}`} className={cn('text-[11px] px-2 py-1 rounded-md border', toneClass)}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function StrategyList({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">{label}</p>
      <ul className="space-y-1">
        {items.map((item, idx) => (
          <li key={`${label}-${idx}`} className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed flex gap-2">
            <span className="text-slate-500 flex-shrink-0">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StrategyPreviewCard({ strategy, searchStrategy }: { strategy: StrategyPreview; searchStrategy: string }) {
  const hasAny =
    strategy.buyerIndustries.length ||
    strategy.buyerPersonas.length ||
    strategy.demandSignals.length ||
    strategy.searchPlan.length ||
    strategy.exclusions.length ||
    strategy.expectedQuality;
  if (!hasAny) return null;

  const routeLabel =
    searchStrategy === 'SERP' ? 'Google Search → Apollo enrichment'
    : searchStrategy === 'APOLLO' ? 'Apollo people/company search'
    : searchStrategy === 'BOTH' ? 'SERP + Apollo (hybrid)'
    : 'Buyer-intent discovery';

  return (
    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Sparkles size={13} className="text-blue-400" />
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">AI Buyer Strategy</p>
        </div>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded border bg-blue-500/10 text-blue-300 border-blue-500/20">
          {routeLabel}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <StrategyChips label="Buyer industries" items={strategy.buyerIndustries} tone="violet" />
        <StrategyChips label="Buyer personas" items={strategy.buyerPersonas} tone="emerald" />
      </div>

      <StrategyList label="Demand signals" items={strategy.demandSignals} />
      <StrategyList label="Search plan" items={strategy.searchPlan} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <StrategyChips label="Exclusions" items={strategy.exclusions} tone="rose" />
        {strategy.expectedQuality ? (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Expected quality</p>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{strategy.expectedQuality}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PromptCard({
  title,
  accentClass,
  prompt,
  onChange,
  onRegenerate,
  regeneratePending,
  onStart,
  startPending,
  startDisabled,
  quotaReached,
}: {
  title: string;
  accentClass: string;
  prompt: PromptState;
  onChange: (value: string) => void;
  onRegenerate: () => void;
  regeneratePending: boolean;
  onStart: () => void;
  startPending: boolean;
  startDisabled: boolean;
  quotaReached: boolean;
}) {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="section-title">{title}</h2>
            <span
              className={cn(
                'text-[10px] font-semibold px-1.5 py-0.5 rounded border',
                prompt.edited
                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/25'
                  : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
              )}
            >
              {prompt.edited ? 'EDITED' : 'AI GENERATED'}
            </span>
            {prompt.buyerType && (
              <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded border', accentClass)}>
                {prompt.buyerType}
              </span>
            )}
          </div>
          {prompt.summary && <p className="text-xs text-slate-500">{prompt.summary}</p>}
        </div>
        <button
          className="btn-ghost text-xs py-1.5 px-2.5 flex items-center gap-1.5 flex-shrink-0"
          onClick={onRegenerate}
          disabled={regeneratePending}
          title="Regenerate"
        >
          <RotateCcw size={11} />
          Regenerate
        </button>
      </div>

      <StrategyPreviewCard strategy={prompt.strategy} searchStrategy={prompt.searchStrategy} />

      <div className="relative">
        <textarea
          className="input text-xs leading-relaxed resize-none w-full font-mono"
          rows={14}
          value={prompt.text}
          onChange={event => onChange(event.target.value)}
          placeholder="AI strategy will appear here..."
        />
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-white/80 dark:bg-slate-900/80 backdrop-blur rounded-lg px-2 py-1 pointer-events-none">
          <Edit3 size={9} className="text-slate-600" />
          <span className="text-[9px] text-slate-600">editable</span>
        </div>
      </div>

      <p className="text-xs text-slate-600 leading-relaxed">
        Review the buyer strategy above. Edit industries, buyer roles, exclusions, or signal ideas in the prompt before starting the scan.
      </p>

      <button
        className="btn-primary w-full py-3 text-sm justify-center"
        onClick={onStart}
        disabled={startDisabled || quotaReached}
        title={quotaReached ? 'Lead quota reached' : ''}
      >
        {startPending ? (
          <>
            <Loader2 size={14} className="animate-spin" /> Starting scan...
          </>
        ) : (
          <>
            <Zap size={14} /> Generate Leads
          </>
        )}
      </button>
      {quotaReached && (
        <p className="text-xs text-red-500 text-center">Lead quota reached. Upgrade plan to discover more.</p>
      )}
    </div>
  );
}

function PlaceholderCard({
  iconColor,
  title,
  body,
  bullets,
}: {
  iconColor: string;
  title: string;
  body: string;
  bullets: string[];
}) {
  return (
    <div className="card p-6 flex flex-col items-center justify-center text-center gap-4 min-h-[300px]">
      <div className={cn('w-14 h-14 rounded-2xl border flex items-center justify-center', iconColor)}>
        <Sparkles size={26} className="text-current" />
      </div>
      <div>
        <p className="font-semibold text-slate-800 dark:text-slate-200 mb-1">{title}</p>
        <p className="text-xs text-slate-500 max-w-xs leading-relaxed">{body}</p>
      </div>
      <div className="space-y-2 w-full text-left">
        {bullets.map(bullet => (
          <div key={bullet} className="flex items-center gap-2.5 bg-slate-100 dark:bg-slate-950 rounded-lg px-3 py-2">
            <p className="text-xs text-slate-500">{bullet}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LeadDiscoveryPage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [scanMode, setScanMode] = useState<ScanMode>('service');

  const [serviceName, setServiceName] = useState('');
  const [serviceGeography, setServiceGeography] = useState('');
  const [serviceDetails, setServiceDetails] = useState('');
  const [serviceBuyerHint, setServiceBuyerHint] = useState('');
  const [serviceIndustry, setServiceIndustry] = useState('');
  const [serviceCompanySize, setServiceCompanySize] = useState('');
  const [serviceCompanyType, setServiceCompanyType] = useState('');
  const [serviceRevenue, setServiceRevenue] = useState('');
  const [serviceDecisionMakers, setServiceDecisionMakers] = useState<string[]>([]);
  const [serviceContactChannel, setServiceContactChannel] = useState('');
  const [serviceSeniorityLevel, setServiceSeniorityLevel] = useState('');
  const [serviceLeadCount, setServiceLeadCount] = useState(50);
  const [serviceExcludeList, setServiceExcludeList] = useState('');
  const [servicePrompt, setServicePrompt] = useState<PromptState>(emptyPrompt());

  const [productName, setProductName] = useState('');
  const [productGeography, setProductGeography] = useState('');
  const [productDetails, setProductDetails] = useState('');
  const [productBuyerHint, setProductBuyerHint] = useState('');
  const [productIndustry, setProductIndustry] = useState('');
  const [productCompanySize, setProductCompanySize] = useState('');
  const [productCompanyType, setProductCompanyType] = useState('');
  const [productRevenue, setProductRevenue] = useState('');
  const [productDecisionMakers, setProductDecisionMakers] = useState<string[]>([]);
  const [productContactChannel, setProductContactChannel] = useState('');
  const [productSeniorityLevel, setProductSeniorityLevel] = useState('');
  const [productLeadCount, setProductLeadCount] = useState(50);
  const [productUrl, setProductUrl] = useState('');
  const [productDocumentText, setProductDocumentText] = useState('');
  const [productFileName, setProductFileName] = useState('');
  const [productPrompt, setProductPrompt] = useState<PromptState>(emptyPrompt());

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

  const { data: allDropdowns } = useQuery({
    queryKey: ['dropdowns', 'active'],
    queryFn: () => dropdownsApi.listActive().then(response => {
      const raw = response.data.data;
      return Array.isArray(raw) ? raw : [];
    }),
  });

  function getDropdownOptions(category: string, defaults: string[]): string[] {
    if (!allDropdowns || !Array.isArray(allDropdowns)) return defaults;
    const items = allDropdowns.filter((item: any) => item.category === category);
    if (items.length === 0) return defaults;
    return items.map((item: any) => item.value);
  }

  const serviceIndustryOptions = getDropdownOptions('resource_industry', DEFAULT_INDUSTRIES);
  const serviceCompanySizeOptions = getDropdownOptions('resource_company_size', DEFAULT_COMPANY_SIZES);
  const serviceCompanyTypeOptions = getDropdownOptions('resource_company_type', DEFAULT_COMPANY_TYPES);
  const serviceDecisionMakerOptions = getDropdownOptions('resource_decision_maker', DEFAULT_DECISION_MAKERS);
  const serviceContactChannelOptions = getDropdownOptions('resource_preferred_contact_channel', DEFAULT_CONTACT_CHANNELS);
  const serviceSeniorityOptions = getDropdownOptions('resource_seniority_level', DEFAULT_SENIORITY_LEVELS);

  const productIndustryOptions = getDropdownOptions('product_industry', DEFAULT_INDUSTRIES);
  const productCompanySizeOptions = getDropdownOptions('product_company_size', DEFAULT_COMPANY_SIZES);
  const productCompanyTypeOptions = getDropdownOptions('product_company_type', DEFAULT_COMPANY_TYPES);
  const productDecisionMakerOptions = getDropdownOptions('product_decision_maker', DEFAULT_DECISION_MAKERS);
  const productContactChannelOptions = getDropdownOptions('product_preferred_contact_channel', DEFAULT_CONTACT_CHANNELS);
  const productSeniorityOptions = getDropdownOptions('product_seniority_level', DEFAULT_SENIORITY_LEVELS);
  const annualRevenueOptions = getDropdownOptions('product_annual_revenue_range', DEFAULT_ANNUAL_REVENUE);

  const { data: serverActiveScan } = useQuery({
    queryKey: ['activeScan'],
    queryFn: () => discoveryApi.getActiveScan().then(response => response.data.data),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!activeScanId && serverActiveScan?.id) setActiveScanId(serverActiveScan.id);
  }, [serverActiveScan, activeScanId]);

  const { data: scansData } = useQuery({
    queryKey: ['scans'],
    queryFn: () => discoveryApi.getScans().then(response => ({
      items: Array.isArray(response.data.data) ? response.data.data : (response.data.data?.items ?? []),
    })),
  });

  const { data: quota } = useQuery({
    queryKey: ['lead-quota'],
    queryFn: () => leadsApi.quota().then(response => response.data?.data),
    staleTime: 60000,
  });

  const quotaReached = quota?.used >= quota?.quota;

  const { data: activeScan } = useQuery({
    queryKey: ['scan', activeScanId],
    queryFn: () => activeScanId
      ? discoveryApi.getScanStatus(activeScanId).then(response => response.data.data)
      : null,
    enabled: !!activeScanId,
    refetchInterval: activeScanId ? 2000 : false,
  });

  useEffect(() => {
    const count = activeScan?.leadsFound ?? activeScan?.totalLeads ?? activeScan?.leadsCount;
    if (typeof count === 'number' && count > peakLeadsFound) setPeakLeadsFound(count);
  }, [activeScan, peakLeadsFound]);

  useEffect(() => {
    if (activeScan?.status === 'completed' || activeScan?.status === 'failed') {
      const timer = setTimeout(() => {
        setActiveScanId(null);
        setOptimisticProgress(0);
        qc.invalidateQueries({ queryKey: ['scans'] });
        qc.invalidateQueries({ queryKey: ['activeScan'] });
      }, 6000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [activeScan?.status, qc]);

  function startOptimisticProgress() {
    setOptimisticProgress(0);
    setPeakLeadsFound(0);
    let value = 0;
    const timer = setInterval(() => {
      value += 2;
      setOptimisticProgress(value);
      if (value >= 10) clearInterval(timer);
    }, 600);
  }

  function toggleServiceDecisionMaker(value: string) {
    setServiceDecisionMakers(prev => prev.includes(value) ? prev.filter(item => item !== value) : [...prev, value]);
  }

  function toggleProductDecisionMaker(value: string) {
    setProductDecisionMakers(prev => prev.includes(value) ? prev.filter(item => item !== value) : [...prev, value]);
  }

  function resetServicePrompt() {
    setServicePrompt(emptyPrompt());
  }

  function resetProductPrompt() {
    setProductPrompt(emptyPrompt());
  }

  function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setProductFileName(file.name);
    const reader = new FileReader();
    reader.onload = loadEvent => setProductDocumentText((loadEvent.target?.result as string) || '');
    reader.readAsText(file);
    toast.success(`"${file.name}" loaded`);
    resetProductPrompt();
  }

  const serviceRequiredFilled = serviceName.trim().length > 0 && serviceGeography.trim().length > 0;
  const productRequiredFilled = productName.trim().length > 0 && productGeography.trim().length > 0;

  const generateServicePromptMutation = useMutation({
    mutationFn: () => {
      if (!serviceRequiredFilled) throw new Error('Fill in the required fields first');
      return discoveryApi.generateServicePrompt({
        serviceName: serviceName.trim(),
        geography: serviceGeography.trim(),
        offerDetails: serviceDetails.trim() || undefined,
        buyerHint: serviceBuyerHint.trim() || undefined,
        targetIndustry: serviceIndustry || undefined,
        companySize: serviceCompanySize || undefined,
        companyType: serviceCompanyType || undefined,
        annualRevenueRange: serviceRevenue || undefined,
        decisionMakers: serviceDecisionMakers.length ? serviceDecisionMakers : undefined,
        preferredContactChannel: serviceContactChannel || undefined,
        seniorityLevel: serviceSeniorityLevel || undefined,
        excludeList: serviceExcludeList.trim() || undefined,
      });
    },
    onSuccess: response => {
      const data = response.data.data;
      setServicePrompt({
        text: data.promptText || '',
        summary: data.summary || '',
        buyerType: data.buyerType || '',
        searchStrategy: data.searchStrategy || '',
        generated: true,
        edited: false,
        strategy: {
          buyerIndustries: data.strategy?.buyerIndustries || [],
          buyerPersonas:   data.strategy?.buyerPersonas   || [],
          demandSignals:   data.strategy?.demandSignals   || [],
          searchPlan:      data.strategy?.searchPlan      || [],
          exclusions:      data.strategy?.exclusions      || [],
          expectedQuality: data.strategy?.expectedQuality || '',
        },
      });
      toast.success('Buyer strategy generated. Review it before scanning.');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || err.message || 'Failed to generate prompt');
    },
  });

  const generateProductPromptMutation = useMutation({
    mutationFn: () => {
      if (!productRequiredFilled) throw new Error('Fill in the required fields first');
      return discoveryApi.generateProductPrompt({
        productName: productName.trim(),
        geography: productGeography.trim(),
        valueProposition: productDetails.trim() || undefined,
        buyerHint: productBuyerHint.trim() || undefined,
        productUrl: productUrl.trim() || undefined,
        productDocumentText: productDocumentText.trim() || undefined,
        targetIndustry: productIndustry || undefined,
        companySize: productCompanySize || undefined,
        companyType: productCompanyType || undefined,
        annualRevenueRange: productRevenue || undefined,
        decisionMakers: productDecisionMakers.length ? productDecisionMakers : undefined,
        preferredContactChannel: productContactChannel || undefined,
        seniorityLevel: productSeniorityLevel || undefined,
      });
    },
    onSuccess: response => {
      const data = response.data.data;
      setProductPrompt({
        text: data.promptText || '',
        summary: data.summary || '',
        buyerType: data.buyerType || '',
        searchStrategy: data.searchStrategy || '',
        generated: true,
        edited: false,
        strategy: {
          buyerIndustries: data.strategy?.buyerIndustries || [],
          buyerPersonas:   data.strategy?.buyerPersonas   || [],
          demandSignals:   data.strategy?.demandSignals   || [],
          searchPlan:      data.strategy?.searchPlan      || [],
          exclusions:      data.strategy?.exclusions      || [],
          expectedQuality: data.strategy?.expectedQuality || '',
        },
      });
      toast.success('Buyer strategy generated. Review it before scanning.');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || err.message || 'Failed to generate prompt');
    },
  });

  const startServiceScanMutation = useMutation({
    mutationFn: () => {
      if (!servicePrompt.generated || servicePrompt.text.trim().length < 20) {
        throw new Error('Generate and review the buyer strategy first');
      }
      return discoveryApi.startScan({
        serviceName: serviceName.trim(),
        geography: serviceGeography.trim(),
        offerDetails: serviceDetails.trim() || undefined,
        buyerHint: serviceBuyerHint.trim() || undefined,
        customPrompt: servicePrompt.text.trim(),
        targetIndustry: serviceIndustry || undefined,
        companySize: serviceCompanySize || undefined,
        companyType: serviceCompanyType || undefined,
        annualRevenueRange: serviceRevenue || undefined,
        decisionMakers: serviceDecisionMakers.length ? serviceDecisionMakers : undefined,
        preferredContactChannel: serviceContactChannel || undefined,
        seniorityLevel: serviceSeniorityLevel || undefined,
        numberOfLeads: serviceLeadCount,
        excludeList: serviceExcludeList.trim() || undefined,
      });
    },
    onSuccess: response => {
      const id = response.data.data.id ?? response.data.data.jobId;
      setActiveScanId(id);
      startOptimisticProgress();
      qc.invalidateQueries({ queryKey: ['scans'] });
      toast.success('Service lead discovery started');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to start scan'),
  });

  const startProductScanMutation = useMutation({
    mutationFn: () => {
      if (!productPrompt.generated || productPrompt.text.trim().length < 20) {
        throw new Error('Generate and review the buyer strategy first');
      }
      const hasUrl = productUrl.trim().length > 0;
      const hasDoc = productDocumentText.trim().length > 5;
      const productType = hasUrl ? 'url' : hasDoc ? 'document' : 'description';

      return discoveryApi.startProductScan({
        productName: productName.trim(),
        geography: productGeography.trim(),
        valueProposition: productDetails.trim() || undefined,
        buyerHint: productBuyerHint.trim() || undefined,
        productUrl: productUrl.trim() || undefined,
        productDocumentText: productDocumentText.trim() || undefined,
        productType,
        customPrompt: productPrompt.text.trim(),
        targetIndustry: productIndustry || undefined,
        companySize: productCompanySize || undefined,
        companyType: productCompanyType || undefined,
        annualRevenueRange: productRevenue || undefined,
        decisionMakers: productDecisionMakers.length ? productDecisionMakers : undefined,
        preferredContactChannel: productContactChannel || undefined,
        seniorityLevel: productSeniorityLevel || undefined,
        numberOfLeads: productLeadCount,
      });
    },
    onSuccess: response => {
      const id = response.data.data.id ?? response.data.data.jobId;
      setActiveScanId(id);
      startOptimisticProgress();
      qc.invalidateQueries({ queryKey: ['scans'] });
      toast.success('Product lead discovery started');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to start product scan'),
  });

  const isMutating =
    generateServicePromptMutation.isPending ||
    generateProductPromptMutation.isPending ||
    startServiceScanMutation.isPending ||
    startProductScanMutation.isPending;

  const scanning = isMutating || (!!activeScanId && (activeScan == null || ['running', 'pending'].includes(activeScan?.status)));
  const scanProgress = activeScan?.progress && activeScan.progress > 0 ? activeScan.progress : optimisticProgress;
  const scanComplete = activeScan?.status === 'completed';
  const activeScanType = activeScan?.sources?.scanType as ScanMode | undefined;
  const visibleScanType = activeScanType || scanMode;
  const scanSteps = visibleScanType === 'product'
    ? ['AI maps buyer types', 'Search sources execute', 'Scoring likely buyers', 'Filtering competitors', 'Saving leads']
    : ['AI maps buyer types', 'Search sources execute', 'Scoring likely buyers', 'Selecting decision-makers', 'Saving leads'];

  const serviceSteps = [
    { n: '1', label: 'Describe your service', done: serviceRequiredFilled, active: !serviceRequiredFilled },
    { n: '2', label: 'Review AI buyer strategy', done: servicePrompt.generated, active: serviceRequiredFilled && !servicePrompt.generated },
    { n: '3', label: 'Generate leads', done: false, active: servicePrompt.generated && !scanning },
  ];

  const productSteps = [
    { n: '1', label: 'Describe your offer', done: productRequiredFilled, active: !productRequiredFilled },
    { n: '2', label: 'Review AI buyer strategy', done: productPrompt.generated, active: productRequiredFilled && !productPrompt.generated },
    { n: '3', label: 'Generate leads', done: false, active: productPrompt.generated && !scanning },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Lead Discovery</h1>
          <p className="text-sm text-slate-500 mt-1">
            Describe what you offer, let AI plan the buyer search, then launch a focused lead scan.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full lg:w-[560px]">
          <ModeButton
            active={scanMode === 'service'}
            title="Find Buyers for Services"
            subtitle="Consulting, staffing, agencies, software services, and professional offerings."
            onClick={() => setScanMode('service')}
          />
          <ModeButton
            active={scanMode === 'product'}
            title="Find Buyers for Products"
            subtitle="Products, equipment, rentals, physical goods, and catalog offers."
            onClick={() => setScanMode('product')}
          />
        </div>
      </div>

      {scanMode === 'service' && (
        <div className="space-y-4">
          <StepRail steps={serviceSteps} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-4">
              <SectionCard title="Service Offer" subtitle="Start with the basics. Everything else is optional.">
                <div className="pt-4 space-y-4">
                  <div>
                    <MandatoryLabel>What service do you offer?</MandatoryLabel>
                    <input
                      className="input text-sm"
                      placeholder="e.g. DevOps consulting, ERP implementation, generator rental"
                      value={serviceName}
                      onChange={event => {
                        setServiceName(event.target.value);
                        resetServicePrompt();
                      }}
                    />
                  </div>

                  <div>
                    <MandatoryLabel>Target geography</MandatoryLabel>
                    <input
                      className="input text-sm"
                      placeholder="e.g. USA, UAE, India, Europe"
                      value={serviceGeography}
                      onChange={event => {
                        setServiceGeography(event.target.value);
                        resetServicePrompt();
                      }}
                    />
                  </div>

                  <div>
                    <p className="label mb-1.5">Service details</p>
                    <textarea
                      className="input text-sm resize-none w-full"
                      rows={4}
                      placeholder="What do you deliver? How do you help? What outcomes do clients pay for?"
                      value={serviceDetails}
                      onChange={event => {
                        setServiceDetails(event.target.value);
                        resetServicePrompt();
                      }}
                    />
                  </div>

                  <div>
                    <p className="label mb-1.5">Who usually needs this?</p>
                    <textarea
                      className="input text-sm resize-none w-full"
                      rows={3}
                      placeholder="Buyer hints, use cases, industries, pain points, or operational triggers."
                      value={serviceBuyerHint}
                      onChange={event => {
                        setServiceBuyerHint(event.target.value);
                        resetServicePrompt();
                      }}
                    />
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Advanced Filters" subtitle="Optional guardrails for tighter targeting">
                <div className="pt-4 space-y-4">
                  <div>
                    <p className="label mb-1.5">Industry / vertical</p>
                    <select className="input text-sm" value={serviceIndustry} onChange={event => { setServiceIndustry(event.target.value); resetServicePrompt(); }}>
                      {serviceIndustryOptions.map(option => (
                        <option key={option} value={option === 'Any Industry' ? '' : option}>{option}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="label mb-1.5">Company size</p>
                      <select className="input text-sm" value={serviceCompanySize} onChange={event => setServiceCompanySize(event.target.value)}>
                        {serviceCompanySizeOptions.map(option => (
                          <option key={option} value={option === 'Any Size' ? '' : option}>{option}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <p className="label mb-1.5">Company type</p>
                      <select className="input text-sm" value={serviceCompanyType} onChange={event => setServiceCompanyType(event.target.value)}>
                        {serviceCompanyTypeOptions.map(option => (
                          <option key={option} value={option === 'Any' ? '' : option}>{option}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <p className="label mb-1.5">Annual revenue range</p>
                    <select className="input text-sm" value={serviceRevenue} onChange={event => setServiceRevenue(event.target.value)}>
                      {annualRevenueOptions.map(option => (
                        <option key={option} value={option === 'Any' ? '' : option}>{option}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <p className="label mb-2">Who usually buys this?</p>
                    <ChipSelect options={serviceDecisionMakerOptions} selected={serviceDecisionMakers} onToggle={toggleServiceDecisionMaker} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="label mb-1.5">Preferred contact channel</p>
                      <select className="input text-sm" value={serviceContactChannel} onChange={event => setServiceContactChannel(event.target.value)}>
                        {serviceContactChannelOptions.map(option => (
                          <option key={option} value={option === 'Any' ? '' : option}>{option}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <p className="label mb-1.5">Seniority level</p>
                      <select className="input text-sm" value={serviceSeniorityLevel} onChange={event => setServiceSeniorityLevel(event.target.value)}>
                        {serviceSeniorityOptions.map(option => (
                          <option key={option} value={option === 'Any' ? '' : option}>{option}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <p className="label mb-1.5">Exclude these leads</p>
                    <textarea
                      className="input text-sm resize-none w-full"
                      rows={2}
                      placeholder="Competitors, staffing firms, marketplaces, irrelevant company types..."
                      value={serviceExcludeList}
                      onChange={event => setServiceExcludeList(event.target.value)}
                    />
                  </div>

                  <div>
                    <p className="label mb-2">Number of leads</p>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={10}
                        max={500}
                        step={10}
                        value={serviceLeadCount}
                        onChange={event => setServiceLeadCount(Number(event.target.value))}
                        className="flex-1 accent-blue-500"
                      />
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 min-w-[80px] text-right">
                        {serviceLeadCount} leads
                      </span>
                    </div>
                  </div>
                </div>
              </SectionCard>

              {!servicePrompt.generated && (
                <>
                  <button
                    className="btn-primary w-full py-3 text-sm justify-center"
                    onClick={() => generateServicePromptMutation.mutate()}
                    disabled={!serviceRequiredFilled || generateServicePromptMutation.isPending}
                  >
                    {generateServicePromptMutation.isPending ? (
                      <>
                        <Loader2 size={14} className="animate-spin" /> AI is planning your buyer search...
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} /> Generate Buyer Strategy
                      </>
                    )}
                  </button>

                  {!serviceRequiredFilled && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 space-y-1">
                      <p className="text-xs font-semibold text-amber-400 mb-1">Complete the required fields first:</p>
                      {!serviceName.trim() && <p className="text-xs text-amber-300">Service name</p>}
                      {!serviceGeography.trim() && <p className="text-xs text-amber-300">Target geography</p>}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="space-y-4">
              {(scanning || scanComplete) && visibleScanType === 'service' && (
                <div className="card p-6">
                  <h2 className="section-title mb-4">{scanComplete ? 'Scan Complete' : 'Service Scan in Progress'}</h2>
                  {scanComplete ? (
                    <ScanComplete activeScan={activeScan} peakLeadsFound={peakLeadsFound} />
                  ) : (
                    <ScanProgress activeScan={activeScan} scanProgress={scanProgress} color="blue" steps={scanSteps} />
                  )}
                </div>
              )}

              {servicePrompt.generated && !scanning && !scanComplete ? (
                <PromptCard
                  title="AI Buyer Strategy"
                  accentClass="bg-blue-500/10 text-blue-400 border-blue-500/20"
                  prompt={servicePrompt}
                  onChange={value => setServicePrompt(prev => ({ ...prev, text: value, edited: true }))}
                  onRegenerate={() => generateServicePromptMutation.mutate()}
                  regeneratePending={generateServicePromptMutation.isPending}
                  onStart={() => startServiceScanMutation.mutate()}
                  startPending={startServiceScanMutation.isPending}
                  startDisabled={!servicePrompt.generated || servicePrompt.text.trim().length < 20}
                  quotaReached={quotaReached}
                />
              ) : (
                !scanning && !scanComplete && (
                  <PlaceholderCard
                    iconColor="bg-gradient-to-br from-blue-600/20 to-cyan-500/10 border-blue-500/25 text-blue-400"
                    title="AI Buyer Strategy Preview"
                    body="Give AI a service name and geography, and it will propose buyer types, demand signals, search routes, and exclusions before you scan."
                    bullets={[
                      'Maps the companies most likely to need your service',
                      'Chooses where to search for buyer intent',
                      'Lets you edit the strategy before scanning',
                      'Runs the scan only after your approval',
                    ]}
                  />
                )
              )}
            </div>
          </div>
        </div>
      )}

      {scanMode === 'product' && (
        <div className="space-y-4">
          <StepRail steps={productSteps} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-4">
              <SectionCard title="Product / Offer" subtitle="Use this for products, rentals, equipment, or catalog offers.">
                <div className="pt-4 space-y-4">
                  <div>
                    <MandatoryLabel>What do you offer?</MandatoryLabel>
                    <input
                      className="input text-sm"
                      placeholder="e.g. Diesel generators, CRM software, LED display boards"
                      value={productName}
                      onChange={event => {
                        setProductName(event.target.value);
                        resetProductPrompt();
                      }}
                    />
                  </div>

                  <div>
                    <MandatoryLabel>Target geography</MandatoryLabel>
                    <input
                      className="input text-sm"
                      placeholder="e.g. UAE, India, Saudi Arabia, Europe"
                      value={productGeography}
                      onChange={event => {
                        setProductGeography(event.target.value);
                        resetProductPrompt();
                      }}
                    />
                  </div>

                  <div>
                    <p className="label mb-1.5">Offer details / use cases</p>
                    <textarea
                      className="input text-sm resize-none w-full"
                      rows={4}
                      placeholder="What is it, how is it used, and what results does it help buyers achieve?"
                      value={productDetails}
                      onChange={event => {
                        setProductDetails(event.target.value);
                        resetProductPrompt();
                      }}
                    />
                  </div>

                  <div>
                    <p className="label mb-1.5">Who usually needs it?</p>
                    <textarea
                      className="input text-sm resize-none w-full"
                      rows={3}
                      placeholder="Buyer industries, operating conditions, project types, or procurement triggers."
                      value={productBuyerHint}
                      onChange={event => {
                        setProductBuyerHint(event.target.value);
                        resetProductPrompt();
                      }}
                    />
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Reference Material" subtitle="Optional inputs that help AI understand the offer better" defaultOpen={false}>
                <div className="pt-5 space-y-6">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-lg bg-blue-500/15 border border-blue-500/25 flex items-center justify-center flex-shrink-0">
                        <Link2 size={13} className="text-blue-400" />
                      </div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Offer URL</p>
                    </div>
                    <div className="flex gap-2">
                      <input
                        className="input text-sm flex-1"
                        placeholder="https://your-offer.com"
                        value={productUrl}
                        onChange={event => {
                          setProductUrl(event.target.value);
                          resetProductPrompt();
                        }}
                      />
                      {productUrl && (
                        <a href={productUrl} target="_blank" rel="noreferrer" className="btn-ghost flex-shrink-0 px-2.5">
                          <ExternalLink size={13} />
                        </a>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 mt-1.5">AI can pull offer context from your landing page or catalog URL.</p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-slate-200 dark:bg-white/[0.06]" />
                    <span className="text-[10px] text-slate-500 font-semibold tracking-widest">AND / OR</span>
                    <div className="flex-1 h-px bg-slate-200 dark:bg-white/[0.06]" />
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center flex-shrink-0">
                        <FileText size={13} className="text-emerald-400" />
                      </div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Upload brochure / spec sheet</p>
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.md,.csv,.pdf"
                      onChange={handleFileUpload}
                      className="hidden"
                    />

                    {productDocumentText ? (
                      <div className="bg-slate-100 dark:bg-slate-950 rounded-xl p-3 border border-emerald-500/20">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={13} className="text-emerald-400" />
                            <span className="text-xs text-emerald-400 font-medium">{productFileName}</span>
                          </div>
                          <button
                            onClick={() => {
                              setProductDocumentText('');
                              setProductFileName('');
                              resetProductPrompt();
                            }}
                            className="text-slate-500 hover:text-red-400 transition-colors"
                            aria-label="Remove uploaded file"
                          >
                            <X size={12} />
                          </button>
                        </div>
                        <p className="text-xs text-slate-500 line-clamp-2">{productDocumentText.slice(0, 180)}...</p>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full border-2 border-dashed border-slate-300 dark:border-white/[0.08] hover:border-emerald-500/30 rounded-xl p-5 text-center transition-colors group"
                      >
                        <Upload size={20} className="mx-auto mb-2 text-slate-500 group-hover:text-emerald-400 transition-colors" />
                        <p className="text-sm text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300">Click to upload .txt, .md, .csv, or .pdf</p>
                        <p className="text-xs text-slate-500 mt-1">Max 5 MB</p>
                      </button>
                    )}
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Advanced Filters" subtitle="Optional guardrails for tighter targeting">
                <div className="pt-4 space-y-4">
                  <div>
                    <p className="label mb-1.5">Industry / vertical</p>
                    <select className="input text-sm" value={productIndustry} onChange={event => { setProductIndustry(event.target.value); resetProductPrompt(); }}>
                      {productIndustryOptions.map(option => (
                        <option key={option} value={option === 'Any Industry' ? '' : option}>{option}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="label mb-1.5">Company size</p>
                      <select className="input text-sm" value={productCompanySize} onChange={event => setProductCompanySize(event.target.value)}>
                        {productCompanySizeOptions.map(option => (
                          <option key={option} value={option === 'Any Size' ? '' : option}>{option}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <p className="label mb-1.5">Company type</p>
                      <select className="input text-sm" value={productCompanyType} onChange={event => setProductCompanyType(event.target.value)}>
                        {productCompanyTypeOptions.map(option => (
                          <option key={option} value={option === 'Any' ? '' : option}>{option}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <p className="label mb-1.5">Annual revenue range</p>
                    <select className="input text-sm" value={productRevenue} onChange={event => setProductRevenue(event.target.value)}>
                      {annualRevenueOptions.map(option => (
                        <option key={option} value={option === 'Any' ? '' : option}>{option}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <p className="label mb-2">Who usually buys this?</p>
                    <ChipSelect options={productDecisionMakerOptions} selected={productDecisionMakers} onToggle={toggleProductDecisionMaker} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="label mb-1.5">Preferred contact channel</p>
                      <select className="input text-sm" value={productContactChannel} onChange={event => setProductContactChannel(event.target.value)}>
                        {productContactChannelOptions.map(option => (
                          <option key={option} value={option === 'Any' ? '' : option}>{option}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <p className="label mb-1.5">Seniority level</p>
                      <select className="input text-sm" value={productSeniorityLevel} onChange={event => setProductSeniorityLevel(event.target.value)}>
                        {productSeniorityOptions.map(option => (
                          <option key={option} value={option === 'Any' ? '' : option}>{option}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <p className="label mb-2">Number of leads</p>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={10}
                        max={500}
                        step={10}
                        value={productLeadCount}
                        onChange={event => setProductLeadCount(Number(event.target.value))}
                        className="flex-1 accent-violet-500"
                      />
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 min-w-[80px] text-right">
                        {productLeadCount} leads
                      </span>
                    </div>
                  </div>
                </div>
              </SectionCard>

              {!productPrompt.generated && (
                <>
                  <button
                    className="btn-primary w-full py-3 text-sm justify-center"
                    onClick={() => generateProductPromptMutation.mutate()}
                    disabled={!productRequiredFilled || generateProductPromptMutation.isPending}
                  >
                    {generateProductPromptMutation.isPending ? (
                      <>
                        <Loader2 size={14} className="animate-spin" /> AI is planning your buyer search...
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} /> Generate Buyer Strategy
                      </>
                    )}
                  </button>

                  {!productRequiredFilled && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 space-y-1">
                      <p className="text-xs font-semibold text-amber-400 mb-1">Complete the required fields first:</p>
                      {!productName.trim() && <p className="text-xs text-amber-300">Offer name</p>}
                      {!productGeography.trim() && <p className="text-xs text-amber-300">Target geography</p>}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="space-y-4">
              {(scanning || scanComplete) && visibleScanType === 'product' && (
                <div className="card p-6">
                  <h2 className="section-title mb-4">{scanComplete ? 'Scan Complete' : 'Product Scan in Progress'}</h2>
                  {scanComplete ? (
                    <ScanComplete activeScan={activeScan} peakLeadsFound={peakLeadsFound} />
                  ) : (
                    <ScanProgress activeScan={activeScan} scanProgress={scanProgress} color="violet" steps={scanSteps} />
                  )}
                </div>
              )}

              {productPrompt.generated && !scanning && !scanComplete ? (
                <PromptCard
                  title="AI Buyer Strategy"
                  accentClass="bg-violet-500/10 text-violet-400 border-violet-500/20"
                  prompt={productPrompt}
                  onChange={value => setProductPrompt(prev => ({ ...prev, text: value, edited: true }))}
                  onRegenerate={() => generateProductPromptMutation.mutate()}
                  regeneratePending={generateProductPromptMutation.isPending}
                  onStart={() => startProductScanMutation.mutate()}
                  startPending={startProductScanMutation.isPending}
                  startDisabled={!productPrompt.generated || productPrompt.text.trim().length < 20}
                  quotaReached={quotaReached}
                />
              ) : (
                !scanning && !scanComplete && (
                  <PlaceholderCard
                    iconColor="bg-gradient-to-br from-violet-600/20 to-blue-500/10 border-violet-500/25 text-violet-400"
                    title="AI Buyer Strategy Preview"
                    body="Give AI the offer name and geography, and it will map buyer industries, intent signals, routes, and exclusions before any scan starts."
                    bullets={[
                      'Identifies companies likely to need the offer',
                      'Chooses search paths like Apollo, organic search, tenders, and company pages',
                      'Lets you edit the strategy before scanning',
                      'Runs the scan only after your approval',
                    ]}
                  />
                )
              )}
            </div>
          </div>
        </div>
      )}

      {(scansData?.items?.length ?? 0) > 0 && (
        <div className="card p-5">
          <h2 className="section-title mb-4">Scan History</h2>
          <div className="space-y-2">
            {(scansData!.items as any[]).slice(0, 8).map((scan: any) => {
              const isProduct = scan.sources?.scanType === 'product';
              const offerLabel = scan.sources?.offerName
                || scan.sources?.productName
                || scan.sources?.serviceName
                || scan.positionTitle
                || (scan.services ?? []).slice(0, 1).join(', ');

              return (
                <div key={scan.id} className="flex items-center justify-between p-3 bg-slate-100 dark:bg-slate-950 rounded-xl gap-3">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <Badge
                      color={
                        scan.status === 'completed' ? 'green'
                          : scan.status === 'running' ? 'blue'
                            : scan.status === 'failed' ? 'red' : 'gray'
                      }
                    >
                      {scan.status}
                    </Badge>
                    <span
                      className={cn(
                        'text-xs rounded px-1.5 py-0.5 border',
                        isProduct ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                      )}
                    >
                      {isProduct ? 'products' : 'services'}
                    </span>
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{scan.leadsFound ?? 0} leads</span>
                    {(scan.geography || scan.targetRegion) && (
                      <span className="text-xs text-slate-500">· {scan.geography || scan.targetRegion}</span>
                    )}
                    {offerLabel && (
                      <span className="text-xs text-slate-500 truncate hidden sm:inline">· {offerLabel}</span>
                    )}
                  </div>
                  <span className="text-xs text-slate-500 flex-shrink-0">{formatDate(scan.createdAt)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ScanProgress({
  activeScan,
  scanProgress,
  steps,
  color = 'blue',
}: {
  activeScan: any;
  scanProgress: number;
  steps: string[];
  color?: 'blue' | 'violet';
}) {
  const palette = color === 'violet'
    ? {
        panel: 'bg-violet-500/[0.06] border-violet-500/20',
        dot: 'bg-violet-400',
        text: 'text-violet-300',
        subtext: 'text-violet-400',
        active: 'text-violet-400',
      }
    : {
        panel: 'bg-blue-500/[0.06] border-blue-500/20',
        dot: 'bg-blue-400',
        text: 'text-blue-300',
        subtext: 'text-blue-400',
        active: 'text-blue-400',
      };

  return (
    <div className="space-y-4">
      <div className={cn('p-4 border rounded-xl', palette.panel)}>
        <div className="flex items-center gap-2 mb-3">
          <div className={cn('w-2 h-2 rounded-full animate-pulse', palette.dot)} />
          <span className={cn('text-sm font-semibold', palette.text)}>Finding buyer companies...</span>
          <span className={cn('ml-auto text-xs font-mono', palette.subtext)}>{scanProgress}%</span>
        </div>
        <ProgressBar value={scanProgress} color="blue" />
        <p className={cn('text-xs mt-2', palette.subtext)}>{activeScan?.leadsFound ?? 0} leads found so far</p>
      </div>

      <div className="space-y-2">
        {steps.map((step, index) => {
          const threshold = ((index + 1) / steps.length) * 100;
          const done = scanProgress >= threshold;
          const active = !done && scanProgress >= threshold - (100 / steps.length);

          return (
            <div
              key={step}
              className={cn(
                'flex items-center gap-2 text-xs transition-all',
                done ? 'text-emerald-400' : active ? palette.active : 'text-slate-500'
              )}
            >
              {done ? (
                <CheckCircle2 size={11} className="flex-shrink-0" />
              ) : active ? (
                <Loader2 size={11} className="animate-spin flex-shrink-0" />
              ) : (
                <span className="w-3 text-center flex-shrink-0">○</span>
              )}
              {step}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-slate-500 text-center">Progress is saved, so it is safe to navigate away.</p>
    </div>
  );
}

function ScanComplete({ activeScan, peakLeadsFound = 0 }: { activeScan: any; peakLeadsFound?: number }) {
  const leadsFound = activeScan?.leadsFound || activeScan?.totalLeads || activeScan?.leadsCount || peakLeadsFound;

  return (
    <div className="flex flex-col items-center justify-center text-center gap-4 py-4">
      <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
        <CheckCircle2 size={30} className="text-emerald-400" />
      </div>
      <div>
        <p className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Scan Complete</p>
        <p className="text-3xl font-bold text-emerald-400">{leadsFound}</p>
        <p className="text-sm text-slate-500 mt-1">new leads discovered</p>
      </div>
      <a href="/dashboard/leads" className="btn-primary text-sm px-6 py-2.5 w-full justify-center">
        <Users size={14} /> View All Leads
      </a>
    </div>
  );
}
