'use client';
import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { discoveryApi, leadsApi, dropdownsApi } from '../../../lib/api';
import { Badge, ProgressBar, Spinner } from '../../../components/ui';
import {
  X, Zap, Loader2, CheckCircle2,
  Link2, FileText,
  ChevronDown, ChevronUp, Upload, ExternalLink,
  Target, Users, Edit3,
  Sparkles, ArrowRight, RotateCcw,
} from 'lucide-react';
import toast from 'react-hot-toast';
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

function SectionCard({
  title, subtitle, defaultOpen = true, children,
}: { title: string; subtitle?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-200/20 dark:hover:bg-slate-800/20 transition-colors text-left">
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {open ? <ChevronUp size={14} className="text-slate-500 flex-shrink-0" />
          : <ChevronDown size={14} className="text-slate-500 flex-shrink-0" />}
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
  options, selected, onToggle, color = 'violet',
}: { options: string[]; selected: string[]; onToggle: (v: string) => void; color?: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => {
        const active = selected.includes(opt);
        return (
          <button key={opt} type="button" onClick={() => onToggle(opt)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
              active
                ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                : 'bg-slate-100 dark:bg-slate-950 border-slate-200 dark:border-white/[0.06] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:border-slate-400 dark:hover:border-white/20'
            )}>
            <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', active ? 'bg-violet-400' : 'bg-slate-500')} />
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export default function LeadDiscoveryPage() {
  const qc = useQueryClient();
  const [scanMode, setScanMode] = useState<'service' | 'product' | null>(null);

  // Positions mode — mandatory
  const [positionTitle, setPositionTitle] = useState('');
  const [description, setDescription] = useState('');
  const [geography, setGeography] = useState('');
  const [skillsRequired, setSkillsRequired] = useState('');

  // Positions mode — optional
  const [targetIndustry, setTargetIndustry] = useState('');
  const [companySize, setCompanySize] = useState('');
  const [companyType, setCompanyType] = useState('');
  const [selectedDecisionMakers, setSelectedDecisionMakers] = useState<string[]>([]);
  const [contactChannel, setContactChannel] = useState('');
  const [seniorityLevel, setSeniorityLevel] = useState('');
  const [leadCount, setLeadCount] = useState(50);

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
  const [productLeadCount, setProductLeadCount] = useState(50);
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
  });
  useEffect(() => {
    if (!activeScanId && serverActiveScan?.id) setActiveScanId(serverActiveScan.id);
  }, [serverActiveScan, activeScanId]);

  const { data: scansData } = useQuery({
    queryKey: ['scans'],
    queryFn: () => discoveryApi.getScans().then(r => ({
      items: Array.isArray(r.data.data) ? r.data.data : (r.data.data?.items ?? []),
    })),
  });

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
    enabled: !!activeScanId,
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
    positionTitle.trim().length > 0 &&
    description.trim().length > 0 &&
    geography.trim().length > 0 &&
    skillsRequired.trim().length > 0;

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
        numberOfLeads: leadCount,
        // Legacy compat
        targetRegion: geography.trim(),
        decisionMakerRoles: selectedDecisionMakers,
        leadCount,
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
        numberOfLeads: productLeadCount || undefined,
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

  return (
    <div className="space-y-5">

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Lead Discovery Engine</h1>
          <p className="text-sm text-slate-500 mt-1">
            What would you like to generate leads for?
          </p>
        </div>
      </div>

      {/* AI Smart Search */}
      {/* <div className="card overflow-hidden">
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/25 flex items-center justify-center flex-shrink-0">
              <Sparkles size={13} className="text-violet-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">AI Smart Search</p>
              <p className="text-xs text-slate-500">Describe your ideal lead in plain English — AI generates leads directly</p>
            </div>
          </div>

          {smartScanning ? (
            <ScanProgress scanning activeScan={activeScan} scanProgress={scanProgress} color="violet"
              steps={['AI parses your prompt', 'Generating job title variants', 'Scanning Google Jobs', 'Filtering results', 'Saving leads']} />
          ) : scanComplete && activeScan ? (
            <ScanComplete activeScan={activeScan} />
          ) : (
            <>
              <div className="flex gap-2">
                <textarea
                  className="input text-sm resize-none flex-1 leading-relaxed"
                  rows={2}
                  placeholder='e.g. "Find 50 CTOs at mid-size SaaS companies in the USA that need DevOps consulting"'
                  value={smartPrompt}
                  onChange={e => setSmartPrompt(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) smartScanMutation.mutate(); }}
                />
                <button
                  className="btn-primary flex-shrink-0 px-5 self-stretch text-sm"
                  onClick={() => smartScanMutation.mutate()}
                  disabled={!smartPrompt.trim() || quotaReached}
                  title={quotaReached ? 'Lead quota reached' : ''}
                >
                  <Zap size={14} /> Generate Leads
                </button>
              </div>
              <p className="text-xs text-slate-600 mt-2">
                Press <kbd className="px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[10px] font-mono">Ctrl+Enter</kbd> to search · or use the structured form below for more control
              </p>
            </>
          )}
        </div>
      </div> */}

      {/* Mode dropdown */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <select
            aria-label="Discovery mode"
            value={scanMode ?? ''}
            onChange={e => setScanMode((e.target.value as 'service' | 'product') || null)}
            className="input text-sm pr-8 appearance-none cursor-pointer min-w-[300px] font-medium"
          >
            <option value="">Select discovery mode...</option>
            <option value="service">Find Clients for Our Resources </option>
            <option value="product">Find Customers for Our Product </option>
          </select>
          <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>
        {scanMode && (
          <span className={cn(
            'text-xs font-medium px-2.5 py-1 rounded-lg border',
            scanMode === 'service'
              ? 'bg-blue-500/10 border-blue-500/25 text-blue-400'
              : 'bg-violet-500/10 border-violet-500/25 text-violet-400'
          )}>
            {scanMode === 'service' ? 'Positions' : 'Products'}
          </span>
        )}
      </div>

      {/* POSITIONS MODE */}
      {scanMode === 'service' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-4">

            <SectionCard title="Position Details" subtitle="Mandatory fields — fill all to enable scanning">
              <div className="pt-4 space-y-4">
                <p className="text-[10px] text-slate-500 flex items-center gap-1">
                  <span className="text-red-400 font-bold">*</span> Required fields
                </p>

                <div>
                  <MandatoryLabel>Position Title / Job Profile</MandatoryLabel>
                  <input className="input text-sm"
                    placeholder="e.g. NetSuite Consultant, Salesforce Admin, SAP Developer"
                    value={positionTitle} onChange={e => setPositionTitle(e.target.value)} />
                  <p className="text-xs text-slate-600 mt-1.5">Be specific — "NetSuite Consultant" beats "ERP"</p>
                </div>

                <div>
                  <MandatoryLabel>Geography / Region</MandatoryLabel>
                  <input className="input text-sm" placeholder="e.g. USA, India, UK, Europe"
                    value={geography} onChange={e => setGeography(e.target.value)} />
                </div>

                <div>
                  <MandatoryLabel>Skills / Key Requirements</MandatoryLabel>
                  <textarea className="input text-sm resize-none w-full" rows={3}
                    placeholder="e.g. SAP S/4HANA, Oracle ERP, 5+ years experience, implementation skills..."
                    value={skillsRequired} onChange={e => setSkillsRequired(e.target.value)} />
                </div>

                <div>
                  <MandatoryLabel>Description</MandatoryLabel>
                  <textarea className="input text-sm resize-none w-full" rows={4}
                    placeholder="Please enter a detailed description"
                    value={description} onChange={e => setDescription(e.target.value)} />
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Optional Filters" subtitle="Leave blank for any" defaultOpen={true}>
              <div className="pt-4 space-y-4">

                <div>
                  <p className="label mb-1.5">Industry / Vertical</p>
                  <select aria-label="Industry" className="input text-sm" value={targetIndustry} onChange={e => setTargetIndustry(e.target.value)}>
                    {resourceIndustryOptions.map(opt => <option key={opt} value={opt === 'Any Industry' ? '' : opt}>{opt}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="label mb-1.5">Company Size</p>
                    <select aria-label="Company size" className="input text-sm" value={companySize} onChange={e => setCompanySize(e.target.value)}>
                      {resourceCompanySizeOptions.map(opt => <option key={opt} value={opt === 'Any Size' ? '' : opt}>{opt}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="label mb-1.5">Company Type</p>
                    <select aria-label="Company type" className="input text-sm" value={companyType} onChange={e => setCompanyType(e.target.value)}>
                      {resourceCompanyTypeOptions.map(opt => <option key={opt} value={opt === 'Any' ? '' : opt}>{opt}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <p className="label mb-2">Who approves hiring? (Decision Maker)</p>
                  <ChipSelect
                    options={resourceDecisionMakerOptions}
                    selected={selectedDecisionMakers}
                    onToggle={toggleDecisionMaker}
                    color="violet"
                  />
                  {selectedDecisionMakers.length === 0 && (
                    <p className="text-xs text-slate-500 mt-2">No roles selected — Apollo searches for default decision makers</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="label mb-1.5">Preferred Contact Channel</p>
                    <select aria-label="Contact channel" className="input text-sm" value={contactChannel} onChange={e => setContactChannel(e.target.value)}>
                      {resourceContactChannelOptions.map(opt => <option key={opt} value={opt === 'Any' ? '' : opt}>{opt}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="label mb-1.5">Seniority Level</p>
                    <select aria-label="Seniority level" className="input text-sm" value={seniorityLevel} onChange={e => setSeniorityLevel(e.target.value)}>
                      {resourceSeniorityOptions.map(opt => <option key={opt} value={opt === 'Any' ? '' : opt}>{opt}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <MandatoryLabel>Number of Leads</MandatoryLabel>
                  <div className="flex items-center gap-3 mt-1">
                    <input type="range" aria-label="Number of leads" min={10} max={500} step={10} value={leadCount}
                      onChange={e => setLeadCount(Number(e.target.value))}
                      className="flex-1 accent-violet-500" />
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 min-w-[80px] text-right">{leadCount} leads</span>
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>

          {/* Right: scan control */}
          <div className="card p-6 flex flex-col min-h-[320px]">
            <h2 className="section-title mb-4">Discovery Control</h2>
            {scanning ? (
              <ScanProgress scanning activeScan={activeScan} scanProgress={scanProgress} color="blue"
                steps={['AI generates job title variants', 'Google Jobs page 1', 'Google Jobs page 2', 'Google Jobs page 3', 'Filtering agencies', 'More variants', 'Deduplicating', 'Saving leads']} />
            ) : scanComplete ? (
              <ScanComplete activeScan={activeScan} peakLeadsFound={peakLeadsFound} />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600/20 to-cyan-500/10 border border-blue-500/25 flex items-center justify-center">
                  <Target size={28} className="text-blue-400" />
                </div>
                <div>
                  <p className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Ready to Discover Leads</p>
                  <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                    Google Jobs engine finds companies ACTIVELY HIRING for this position.
                    AI generates job title variants — no static lists.
                    {geography ? ` Targeting ${geography}.` : ' Fill in the mandatory fields to begin.'}
                  </p>
                </div>
                {!positionsMandatoryFilled && (
                  <div className="w-full bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-left space-y-1">
                    <p className="text-xs font-semibold text-amber-400 mb-1.5">Complete mandatory fields to scan:</p>
                    {!description.trim() && <p className="text-xs text-amber-300 flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" /> Description</p>}
                    {!positionTitle.trim() && <p className="text-xs text-amber-300 flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" /> Position Title</p>}
                    {!geography.trim() && <p className="text-xs text-amber-300 flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" /> Geography</p>}
                    {!skillsRequired.trim() && <p className="text-xs text-amber-300 flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" /> Skills / Key Requirements</p>}
                  </div>
                )}
                <button className="btn-primary px-8 py-3 text-sm w-full justify-center"
                  onClick={() => scanMutation.mutate()}
                  disabled={scanMutation.isPending || quotaReached}
                  title={quotaReached ? 'Lead quota reached' : ''}
                >
                  {scanMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
                  Generate Leads
                </button>
                {quotaReached && (
                  <p className="text-xs text-red-500">Lead quota reached. Upgrade plan to discover more.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PRODUCTS MODE */}
      {scanMode === 'product' && (
        <div className="space-y-4">

          <div className="flex items-center gap-2">
            {[
              { n: '1', label: 'Enter product info', done: hasProductInputs, active: !hasProductInputs },
              { n: '2', label: 'Review AI prompt', done: promptGenerated, active: hasProductInputs && !promptGenerated },
              { n: '3', label: 'Start scan', done: false, active: promptGenerated && !scanning },
            ].map(({ n, label, done, active }, i) => (
              <div key={n} className="flex items-center gap-2">
                <div className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                  done ? 'bg-emerald-500/20 text-emerald-400' : active ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-200 dark:bg-slate-800 text-slate-600'
                )}>
                  {done ? '✓' : n}
                </div>
                <span className={cn('text-xs font-medium', done ? 'text-emerald-400' : active ? 'text-slate-800 dark:text-slate-200' : 'text-slate-600')}>
                  {label}
                </span>
                {i < 2 && <ArrowRight size={12} className="text-slate-700 flex-shrink-0" />}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-4">

              <SectionCard title="Product Details" subtitle="Mandatory fields — fill all to enable scanning">
                <div className="pt-4 space-y-4">
                  <p className="text-[10px] text-slate-500 flex items-center gap-1">
                    <span className="text-red-400 font-bold">*</span> Required fields
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
                    <input className="input text-sm" placeholder="e.g. USA, India, UK, Europe"
                      value={productGeography}
                      onChange={e => { setProductGeography(e.target.value); resetPrompt(); }} />
                  </div>

                  <div>
                    <MandatoryLabel>Value Proposition / Key Benefit</MandatoryLabel>
                    <textarea className="input text-sm resize-none w-full" rows={4}
                      placeholder="Please enter a detailed description — what problem does your product solve? Who needs it? What results does it deliver?"
                      value={valueProposition}
                      onChange={e => { setValueProposition(e.target.value); resetPrompt(); }} />
                    <p className="text-xs text-slate-600 mt-1">{valueProposition.length}/3000 chars</p>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Additional Product Information" subtitle="Optional — helps AI build a better targeting prompt" defaultOpen={false}>
                <div className="pt-5 space-y-6">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-lg bg-blue-500/15 border border-blue-500/25 flex items-center justify-center flex-shrink-0">
                        <Link2 size={13} className="text-blue-400" />
                      </div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Product URL</p>
                      <span className="text-[10px] bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-white/[0.06] text-slate-500 px-1.5 py-0.5 rounded font-medium">OPTIONAL</span>
                    </div>
                    <div className="flex gap-2">
                      <input className="input text-sm flex-1" placeholder="https://yourproduct.com"
                        value={productUrl} onChange={e => { setProductUrl(e.target.value); resetPrompt(); }} />
                      {productUrl && (
                        <a href={productUrl} target="_blank" rel="noreferrer" title="Open product URL" className="btn-ghost flex-shrink-0 px-2.5">
                          <ExternalLink size={13} />
                        </a>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 mt-1.5">AI fetches the page to understand what you offer</p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-slate-200 dark:bg-white/[0.06]" />
                    <span className="text-[10px] text-slate-600 font-semibold tracking-widest">AND / OR</span>
                    <div className="flex-1 h-px bg-slate-200 dark:bg-white/[0.06]" />
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center flex-shrink-0">
                        <FileText size={13} className="text-emerald-400" />
                      </div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Upload Brochure / Spec Sheet</p>
                      <span className="text-[10px] bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-white/[0.06] text-slate-500 px-1.5 py-0.5 rounded font-medium">OPTIONAL</span>
                    </div>
                    <input ref={fileInputRef} type="file" accept=".txt,.md,.csv,.pdf"
                      onChange={handleFileUpload} className="hidden" aria-label="Upload brochure or spec sheet" />
                    {productDocumentText ? (
                      <div className="bg-slate-100 dark:bg-slate-950 rounded-xl p-3 border border-emerald-500/20">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={13} className="text-emerald-400" />
                            <span className="text-xs text-emerald-400 font-medium">{productFileName}</span>
                          </div>
                          <button onClick={() => { setProductDocumentText(''); setProductFileName(''); resetPrompt(); }}
                            aria-label="Remove uploaded file"
                            className="text-slate-600 hover:text-red-400 transition-colors">
                            <X size={12} />
                          </button>
                        </div>
                        <p className="text-xs text-slate-500 line-clamp-2">{productDocumentText.slice(0, 180)}...</p>
                      </div>
                    ) : (
                      <button type="button" onClick={() => fileInputRef.current?.click()}
                        className="w-full border-2 border-dashed border-slate-300 dark:border-white/[0.08] hover:border-emerald-500/30 rounded-xl p-5 text-center transition-colors group">
                        <Upload size={20} className="mx-auto mb-2 text-slate-600 group-hover:text-emerald-400 transition-colors" />
                        <p className="text-sm text-slate-400 group-hover:text-slate-500 dark:hover:text-slate-300">Click to upload .txt, .md, or .pdf</p>
                        <p className="text-xs text-slate-600 mt-1">Max 5 MB</p>
                      </button>
                    )}
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Optional Filters" subtitle="Narrow down your target audience" defaultOpen={true}>
                <div className="pt-4 space-y-4">

                  <div>
                    <p className="label mb-1.5">Industry / Vertical</p>
                    <select aria-label="Industry" className="input text-sm" value={productIndustry}
                      onChange={e => { setProductIndustry(e.target.value); resetPrompt(); }}>
                      {productIndustryOptions.map(opt => <option key={opt} value={opt === 'Any Industry' ? '' : opt}>{opt}</option>)}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="label mb-1.5">Company Size</p>
                      <select aria-label="Company size" className="input text-sm" value={productCompanySize} onChange={e => setProductCompanySize(e.target.value)}>
                        {productCompanySizeOptions.map(opt => <option key={opt} value={opt === 'Any Size' ? '' : opt}>{opt}</option>)}
                      </select>
                    </div>
                    <div>
                      <p className="label mb-1.5">Company Type</p>
                      <select aria-label="Company type" className="input text-sm" value={productCompanyType} onChange={e => setProductCompanyType(e.target.value)}>
                        {productCompanyTypeOptions.map(opt => <option key={opt} value={opt === 'Any' ? '' : opt}>{opt}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <p className="label mb-1.5">Annual Revenue Range (USD)</p>
                    <select
                      aria-label="Annual revenue range"
                      className="input text-sm w-full"
                      value={annualRevenue}
                      onChange={e => setAnnualRevenue(e.target.value)}
                    >
                      {productAnnualRevenueOptions.map(opt => (
                        <option key={opt} value={opt === 'Any' ? '' : opt}>{opt}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <p className="label mb-2">Who makes the buying decision?</p>
                    <ChipSelect
                      options={productDecisionMakerOptions}
                      selected={productDecisionMakers}
                      onToggle={toggleProductDecisionMaker}
                      color="violet"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="label mb-1.5">Preferred Contact Channel</p>
                      <select aria-label="Contact channel" className="input text-sm" value={productContactChannel} onChange={e => setProductContactChannel(e.target.value)}>
                        {productContactChannelOptions.map(opt => <option key={opt} value={opt === 'Any' ? '' : opt}>{opt}</option>)}
                      </select>
                    </div>
                    <div>
                      <p className="label mb-1.5">Seniority Level</p>
                      <select aria-label="Seniority level" className="input text-sm" value={productSeniorityLevel} onChange={e => setProductSeniorityLevel(e.target.value)}>
                        {productSeniorityOptions.map(opt => <option key={opt} value={opt === 'Any' ? '' : opt}>{opt}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <p className="label mb-2">Number of Leads to Generate
                      <span className="ml-1.5 text-[10px] text-slate-500 bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-white/[0.06] px-1.5 py-0.5 rounded font-normal">optional</span>
                    </p>
                    <div className="flex items-center gap-3">
                      <input type="range" aria-label="Number of leads" min={10} max={500} step={10} value={productLeadCount}
                        onChange={e => setProductLeadCount(Number(e.target.value))}
                        className="flex-1 accent-violet-500" />
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 min-w-[80px] text-right">{productLeadCount} leads</span>
                    </div>
                  </div>
                </div>
              </SectionCard>

              {!promptGenerated && (
                <>
                  <button
                    className="btn-primary w-full py-3 text-sm justify-center"
                    onClick={() => generatePromptMutation.mutate()}
                    disabled={!hasProductInputs || generatePromptMutation.isPending}>
                    {generatePromptMutation.isPending
                      ? <><Loader2 size={14} className="animate-spin" /> AI analyzing your product...</>
                      : <><Sparkles size={14} /> Generate Discovery Prompt</>}
                  </button>
                  {!hasProductInputs && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 space-y-1">
                      <p className="text-xs font-semibold text-amber-400 mb-1">Complete mandatory fields first:</p>
                      {!productName.trim() && <p className="text-xs text-amber-300 flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" /> Product Name / Category</p>}
                      {!productGeography.trim() && <p className="text-xs text-amber-300 flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" /> Geography / Region</p>}
                      {!valueProposition.trim() && <p className="text-xs text-amber-300 flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" /> Value Proposition</p>}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="space-y-4">
              {(scanning || scanComplete) && (
                <div className="card p-6">
                  <h2 className="section-title mb-4">
                    {scanComplete ? 'Scan Complete' : 'Product Scan in Progress'}
                  </h2>
                  {scanComplete ? (
                    <ScanComplete activeScan={activeScan} peakLeadsFound={peakLeadsFound} />
                  ) : (
                    <ScanProgress scanning activeScan={activeScan} scanProgress={scanProgress} color="violet"
                      steps={['AI call — analyzing product', 'AI batch scoring', 'Filtering competitors', 'Deduplicating', 'Saving leads']} />
                  )}
                </div>
              )}

              {promptGenerated && !scanning && !scanComplete && (
                <div className="card p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h2 className="section-title">AI Discovery Prompt</h2>
                        <span className={cn(
                          'text-[10px] font-semibold px-1.5 py-0.5 rounded border',
                          promptEdited
                            ? 'bg-amber-500/15 text-amber-400 border-amber-500/25'
                            : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                        )}>
                          {promptEdited ? 'EDITED' : 'AI GENERATED'}
                        </span>
                        {promptBuyerType && (
                          <span className={cn(
                            'text-[10px] font-semibold px-1.5 py-0.5 rounded border',
                            promptBuyerType === 'B2B' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                              : promptBuyerType === 'B2C' ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          )}>
                            {promptBuyerType}
                          </span>
                        )}
                      </div>
                      {promptSummary && <p className="text-xs text-slate-500">{promptSummary}</p>}
                    </div>
                    <button
                      className="btn-ghost text-xs py-1.5 px-2.5 flex items-center gap-1.5 flex-shrink-0"
                      onClick={() => generatePromptMutation.mutate()}
                      disabled={generatePromptMutation.isPending}
                      title="Regenerate">
                      <RotateCcw size={11} />
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
                    <div className="absolute top-2 right-2 flex items-center gap-1 bg-white/80 dark:bg-slate-900/80 backdrop-blur rounded-lg px-2 py-1 pointer-events-none">
                      <Edit3 size={9} className="text-slate-600" />
                      <span className="text-[9px] text-slate-600">editable</span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">
                    Review the targeting strategy above. Edit any part — add industries, keywords, change job titles.
                    The scan will use exactly what you see here.
                  </p>

                  <button
                    className="btn-primary w-full py-3 text-sm justify-center"
                    onClick={() => productScanMutation.mutate()}
                    disabled={!canStartProductScan || productScanMutation.isPending || quotaReached}
                    title={quotaReached ? 'Lead quota reached' : ''}
                  >
                    {productScanMutation.isPending
                      ? <><Loader2 size={14} className="animate-spin" /> Starting scan...</>
                      : <><Zap size={14} /> Generate Leads</>}
                  </button>
                  {quotaReached && (
                    <p className="text-xs text-red-500 text-center mt-2">Lead quota reached. Upgrade plan to discover more.</p>
                  )}
                </div>
              )}

              {!promptGenerated && !scanning && !scanComplete && (
                <div className="card p-6 flex flex-col items-center justify-center text-center gap-4 min-h-[300px]">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600/20 to-blue-500/10 border border-violet-500/25 flex items-center justify-center">
                    <Sparkles size={26} className="text-violet-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-200 mb-1">AI Prompt Preview</p>
                    <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                      Fill in the mandatory product details, then click{' '}
                      <span className="text-violet-400 font-medium">Generate Discovery Prompt</span>.
                      AI will build a targeting strategy you can review and edit before scanning.
                    </p>
                  </div>
                  <div className="space-y-2 w-full text-left">
                    {[
                      { icon: 'target', text: 'Identifies who NEEDS your product' },
                      { icon: 'search', text: 'Generates search keywords & queries' },
                      { icon: 'edit', text: 'You review & edit before scanning' },
                      { icon: 'rocket', text: 'Scan runs with your approved prompt' },
                    ].map(({ icon, text }) => (
                      <div key={text} className="flex items-center gap-2.5 bg-slate-100 dark:bg-slate-950 rounded-lg px-3 py-2">
                        <p className="text-xs text-slate-400">{text}</p>
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
          <h2 className="section-title mb-4">Scan History</h2>
          <div className="space-y-2">
            {(scansData!.items as any[]).slice(0, 8).map((scan: any) => {
              const isProduct = scan.sources?.scanType === 'product';
              return (
                <div key={scan.id} className="flex items-center justify-between p-3 bg-slate-100 dark:bg-slate-950 rounded-xl gap-3">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <Badge color={
                      scan.status === 'completed' ? 'green' :
                        scan.status === 'running' ? 'blue' :
                          scan.status === 'failed' ? 'red' : 'gray'
                    }>{scan.status}</Badge>
                    <span className={cn('text-xs rounded px-1.5 py-0.5 border',
                      isProduct ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                        : 'bg-blue-500/10 text-blue-400 border-blue-500/20')}>
                      {isProduct ? 'product' : 'positions'}
                    </span>
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{scan.leadsFound ?? 0} leads</span>
                    {(scan.geography || scan.targetRegion) && (
                      <span className="text-xs text-slate-500">· {scan.geography || scan.targetRegion}</span>
                    )}
                    {scan.avgMatchScore != null && (
                      <span className={cn(
                        'text-xs font-semibold px-2 py-0.5 rounded-full border',
                        scan.avgMatchScore >= 80 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                          scan.avgMatchScore >= 50 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                            'bg-red-500/10 text-red-400 border-red-500/20'
                      )}>
                        {scan.avgMatchScore}% match
                      </span>
                    )}
                    {!isProduct && (scan.positionTitle || (scan.services ?? []).length > 0) && (
                      <span className="text-xs text-slate-500 truncate hidden sm:inline">
                        · {scan.positionTitle || (scan.services as string[]).slice(0, 2).join(', ')}
                      </span>
                    )}
                    {isProduct && (scan.sources?.productName || scan.sources?.productDescriptionSnippet) && (
                      <span className="text-xs text-slate-500 truncate hidden sm:inline">
                        · {scan.sources.productName || scan.sources.productDescriptionSnippet?.slice(0, 50)}
                      </span>
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

function cn2(...cls: (string | boolean | undefined | null)[]) {
  return cls.filter(Boolean).join(' ');
}

function ScanProgress({ activeScan, scanProgress, steps, color = 'blue' }: {
  activeScan: any; scanProgress: number; steps: string[]; scanning?: boolean; color?: string;
}) {
  return (
    <div className="space-y-4">
      <div className={`p-4 bg-${color}-500/[0.06] border border-${color}-500/20 rounded-xl`}>
        <div className="flex items-center gap-2 mb-3">
          <div className={`w-2 h-2 rounded-full bg-${color}-400 animate-pulse`} />
          <span className={`text-sm font-semibold text-${color}-300`}>
            {color === 'violet' ? 'Finding buyer companies...' : 'Scanning for leads...'}
          </span>
          <span className={`ml-auto text-xs text-${color}-400 font-mono`}>{scanProgress}%</span>
        </div>
        <ProgressBar value={scanProgress} color="blue" />
        <p className={`text-xs text-${color}-400 mt-2`}>{activeScan?.leadsFound ?? 0} leads found so far</p>
      </div>
      <div className="space-y-2">
        {steps.map((step, i) => {
          const threshold = (i + 1) / steps.length * 100;
          const done = scanProgress >= threshold;
          const active = !done && scanProgress >= threshold - (100 / steps.length);
          return (
            <div key={i} className={cn2('flex items-center gap-2 text-xs transition-all',
              done ? 'text-emerald-400' : active ? `text-${color}-400` : 'text-slate-600')}>
              {done ? <CheckCircle2 size={11} className="flex-shrink-0" />
                : active ? <Loader2 size={11} className="animate-spin flex-shrink-0" />
                  : <span className="w-3 text-center flex-shrink-0">○</span>}
              {step}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-600 text-center">Progress saved — safe to navigate away</p>
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
        <p className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Scan Complete!</p>
        <p className="text-3xl font-bold text-emerald-400">{leadsFound}</p>
        <p className="text-sm text-slate-500 mt-1">new leads discovered</p>
      </div>
      <a href="/dashboard/leads" className="btn-primary text-sm px-6 py-2.5 w-full justify-center">
        <Users size={14} /> View All Leads
      </a>
    </div>
  );
}
