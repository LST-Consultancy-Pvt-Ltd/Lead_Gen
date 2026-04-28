'use client';
import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { discoveryApi } from '../../../lib/api';
import { Badge, ProgressBar, Spinner } from '../../../components/ui';
import {
  Plus, X, Zap, Loader2, CheckCircle2,
  Link2, FileText, AlignLeft,
  ChevronDown, ChevronUp, Upload, ExternalLink,
  TrendingUp, Target, Users, Edit3,
  Sparkles, ArrowRight, RotateCcw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { formatDate } from '../../../lib/utils';

const WORK_TYPES = [
  { label: 'On-site', icon: '🏢' },
  { label: 'Remote',  icon: '🏠' },
  { label: 'Hybrid',  icon: '🔀' },
];

const ACTIVE_SCAN_KEY = 'lf_active_scan_id';

function cn(...cls: (string | boolean | undefined | null)[]) {
  return cls.filter(Boolean).join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// SectionCard
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function LeadDiscoveryPage() {
  const qc = useQueryClient();

  const [scanMode, setScanMode] = useState<'service' | 'product' | null>(null);

  // Service mode
  const [newService,          setNewService]          = useState('');
  const [workTypes,           setWorkTypes]           = useState<string[]>([]);
  const [targetIndustry,      setTargetIndustry]      = useState('');
  const [targetRegion,        setTargetRegion]        = useState('');
  const [selectedRoles,       setSelectedRoles]       = useState<string[]>([]);
  const [customRoleInput,     setCustomRoleInput]     = useState('');

  function toggleRole(role: string) {
    setSelectedRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]);
  }
  function addCustomRole() {
    const r = customRoleInput.trim();
    if (!r || selectedRoles.includes(r)) return;
    setSelectedRoles(prev => [...prev, r]);
    setCustomRoleInput('');
  }

  // Service mode — extended fields
  const [companySize,    setCompanySize]    = useState('');
  const [companyType,    setCompanyType]    = useState('');
  const [revenueRanges,  setRevenueRanges]  = useState<string[]>([]);
  const [serviceName,    setServiceName]    = useState('');
  const [pricingModel,   setPricingModel]   = useState('');
  const [valueProp,      setValueProp]      = useState('');
  const [keywords,       setKeywords]       = useState('');
  const [contactChannel, setContactChannel] = useState('');
  const [seniorityLevel, setSeniorityLevel] = useState('');
  const [leadCount,      setLeadCount]      = useState(50);
  const [scoreThreshold, setScoreThreshold] = useState('');
  const [excludeList,    setExcludeList]    = useState('');

  function toggleRevenueRange(r: string) {
    setRevenueRanges(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
  }

  // Product mode inputs
  const [productUrl,          setProductUrl]          = useState('');
  const [productDescription,  setProductDescription]  = useState('');
  const [productDocumentText, setProductDocumentText] = useState('');
  const [productFileName,     setProductFileName]     = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AI prompt state (product mode only)
  // Flow: fill inputs → Generate Prompt → review/edit → Start Scan
  const [promptText,      setPromptText]      = useState('');
  const [promptSummary,   setPromptSummary]   = useState('');
  const [promptBuyerType, setPromptBuyerType] = useState('');
  const [promptGenerated, setPromptGenerated] = useState(false);
  const [promptEdited,    setPromptEdited]    = useState(false);

  // Scan state
  const [activeScanId,       setActiveScanId]       = useState<string | null>(null);
  const [optimisticProgress, setOptimisticProgress] = useState(0);

  // Restore
  useEffect(() => {
    const stored = localStorage.getItem(ACTIVE_SCAN_KEY);
    if (stored) setActiveScanId(stored);
  }, []);
  useEffect(() => {
    if (activeScanId) localStorage.setItem(ACTIVE_SCAN_KEY, activeScanId);
    else              localStorage.removeItem(ACTIVE_SCAN_KEY);
  }, [activeScanId]);

  // Server-side active scan restore
  const { data: serverActiveScan } = useQuery({
    queryKey: ['activeScan'],
    queryFn:  () => discoveryApi.getActiveScan().then(r => r.data.data),
    staleTime: 0, refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (!activeScanId && serverActiveScan?.id) setActiveScanId(serverActiveScan.id);
  }, [serverActiveScan, activeScanId]);

  // Data
  const { data: servicesData, isLoading: servicesLoading } = useQuery({
    queryKey: ['services'],
    queryFn:  () => discoveryApi.getServices().then(r => r.data.data),
  });
  const { data: scansData } = useQuery({
    queryKey: ['scans'],
    queryFn:  () => discoveryApi.getScans().then(r => ({
      items: Array.isArray(r.data.data) ? r.data.data : (r.data.data?.items ?? []),
    })),
  });

  // Live poll
  const { data: activeScan } = useQuery({
    queryKey: ['scan', activeScanId],
    queryFn:  () => activeScanId
      ? discoveryApi.getScanStatus(activeScanId).then(r => r.data.data)
      : null,
    enabled:         !!activeScanId,
    refetchInterval: activeScanId ? 2000 : false,
  });
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

  // Service management
  const updateServicesMutation = useMutation({
    mutationFn: (s: any[]) => discoveryApi.updateServices(s),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['services'] }),
  });
  const services: any[] = servicesData ?? [];

  function addService() {
    if (!newService.trim()) return;
    updateServicesMutation.mutate([...services, { name: newService.trim(), isActive: true }]);
    setNewService('');
  }
  function removeService(i: number) {
    updateServicesMutation.mutate(services.filter((_: any, j: number) => j !== i));
  }
  function toggleWorkType(wt: string) {
    setWorkTypes(prev => prev.includes(wt) ? prev.filter(w => w !== wt) : [...prev, wt]);
  }

  // File upload
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
    let v = 0;
    const iv = setInterval(() => { v += 2; setOptimisticProgress(v); if (v >= 10) clearInterval(iv); }, 600);
  }

  // ── STEP 1: Generate AI prompt from product inputs ────────────────────────
  const generatePromptMutation = useMutation({
    mutationFn: () => {
      if (!hasProductInputs) throw new Error('Add a product URL, description, or document first');
      return discoveryApi.generateProductPrompt({
        productUrl:          productUrl.trim()          || undefined,
        productDescription:  productDescription.trim()  || undefined,
        productDocumentText: productDocumentText.trim() || undefined,
        targetIndustry:      targetIndustry.trim()      || undefined,
        targetRegion:        targetRegion.trim()        || undefined,
      });
    },
    onSuccess: res => {
      const d = res.data.data;
      setPromptText(d.promptText   || '');
      setPromptSummary(d.summary   || '');
      setPromptBuyerType(d.buyerType || '');
      setPromptGenerated(true);
      setPromptEdited(false);
      toast.success('Prompt generated — review and edit before scanning');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || err.message || 'Failed to generate prompt');
    },
  });

  // ── Service scan ──────────────────────────────────────────────────────────
  const scanMutation = useMutation({
    mutationFn: () => discoveryApi.startScan({
      targetIndustry, targetRegion, workTypes, decisionMakerRoles: selectedRoles,
      companySize, companyType, revenueRanges,
      serviceName, pricingModel, valueProp, keywords,
      contactChannel, seniorityLevel, leadCount, scoreThreshold, excludeList,
    }),
    onSuccess: res => {
      const id = res.data.data.id ?? res.data.data.jobId;
      setActiveScanId(id);
      toast.success('Scan started!');
      qc.invalidateQueries({ queryKey: ['scans'] });
      startOptimisticProgress();
    },
    onError: () => toast.error('Failed to start scan'),
  });

  // ── STEP 2: Product scan using the finalised prompt ───────────────────────
  const productScanMutation = useMutation({
    mutationFn: () => {
      const hasUrl = productUrl.trim().length > 0;
      const hasDoc = productDocumentText.trim().length > 5;
      let productType = 'description';
      if (hasUrl) productType = 'url';
      else if (hasDoc) productType = 'document';

      return discoveryApi.startProductScan({
        productType,
        productUrl:          productUrl.trim()          || undefined,
        productDescription:  productDescription.trim()  || undefined,
        productDocumentText: productDocumentText.trim() || undefined,
        // Pass the user-approved (possibly edited) prompt
        customPrompt:        promptText.trim()          || undefined,
        targetIndustry, targetRegion, workTypes,
      });
    },
    onSuccess: res => {
      const id = res.data.data.id ?? res.data.data.jobId;
      setActiveScanId(id);
      toast.success('Product scan started!');
      qc.invalidateQueries({ queryKey: ['scans'] });
      startOptimisticProgress();
    },
    onError: () => toast.error('Failed to start product scan'),
  });

  // Derived
  const isMutating     = scanMutation.isPending || productScanMutation.isPending || generatePromptMutation.isPending;
  const scanning       = isMutating || (!!activeScanId && (activeScan == null || ['running','pending'].includes(activeScan?.status)));
  const scanProgress   = (activeScan?.progress != null && activeScan.progress > 0) ? activeScan.progress : optimisticProgress;
  const scanComplete   = activeScan?.status === 'completed';
  const hasProductInputs = productUrl.trim().length > 0 || productDescription.trim().length > 10 || productDocumentText.trim().length > 10;
  const canStartProductScan = promptGenerated && promptText.trim().length > 20;
  const totalLeadsEver = (scansData?.items ?? []).reduce((s: number, j: any) => s + (j.leadsFound ?? 0), 0);

  // AI smart search
  const [smartPrompt, setSmartPrompt] = useState('');

  const smartScanMutation = useMutation({
    mutationFn: () => {
      if (!smartPrompt.trim()) throw new Error('Enter a description first');
      return discoveryApi.smartScan(smartPrompt.trim());
    },
    onSuccess: (res) => {
      const id = res.data.data.id ?? res.data.data.jobId;
      setActiveScanId(id);
      qc.invalidateQueries({ queryKey: ['scans'] });
      startOptimisticProgress();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || err.message || 'Failed to start smart scan');
    },
  });

  const smartScanning = smartScanMutation.isPending || (!!activeScanId && (activeScan == null || ['running','pending'].includes(activeScan?.status)));

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Lead Discovery Engine</h1>
          <p className="text-sm text-slate-500 mt-1">
            Finds companies that <span className="text-emerald-400 font-medium">need</span> your service or product — not competitors
          </p>
        </div>
        {/* <div className="flex items-center gap-3">
          {totalLeadsEver > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/[0.06] rounded-xl px-3 py-2">
              <TrendingUp size={12} className="text-emerald-400" />
              {totalLeadsEver.toLocaleString()} total discovered
            </div>
          )}
          {scanMode === 'service' && (
            <button className="btn-primary px-6 py-2.5 text-sm"
              onClick={() => scanMutation.mutate()}
              disabled={scanning || services.length === 0}>
              {scanning
                ? <><Loader2 size={14} className="animate-spin" /> Scanning…</>
                : <><Zap size={14} /> Launch AI Scan</>}
            </button>
          )}
        </div> */}
      </div>

      {/* AI Smart Search */}
      <div className="card overflow-hidden">
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
                  disabled={!smartPrompt.trim()}
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
      </div>

      {/* Mode dropdown */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <select
            value={scanMode ?? ''}
            onChange={e => setScanMode((e.target.value as 'service' | 'product') || null)}
            className="input text-sm pr-8 appearance-none cursor-pointer min-w-[220px] font-medium"
          >
            <option value="">Select discovery mode…</option>
            <option value="service">Service / Position</option>
            <option value="product">Product Discovery</option>
          </select>
          <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>
        {/* {scanMode && (
          <span className={cn(
            'text-xs font-medium px-2.5 py-1 rounded-lg border',
            scanMode === 'service'
              ? 'bg-blue-500/10 border-blue-500/25 text-blue-400'
              : 'bg-violet-500/10 border-violet-500/25 text-violet-400'
          )}>
            {scanMode === 'service' ? '🎯 Google Jobs engine' : '🤖 AI product matching'}
          </span>
        )} */}
      </div>

      {/* ════════════════════ SERVICE MODE ════════════════════ */}
      {scanMode === 'service' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-4">

            <SectionCard title="Services / Positions"
              subtitle="AI finds companies actively HIRING for this role — they need your services">
              <div className="pt-4">
                {servicesLoading ? <Spinner /> : (
                  <div className="space-y-2 mb-3">
                    {services.map((s: any, i: number) => (
                      <div key={i} className="flex items-center justify-between bg-slate-100 dark:bg-slate-950 rounded-xl px-3 py-2.5 group">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={13} className="text-emerald-400" />
                          <span className="text-sm text-slate-800 dark:text-slate-200">{s.name}</span>
                        </div>
                        <button onClick={() => removeService(i)}
                          aria-label={`Remove ${s.name}`}
                          className="text-slate-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-colors">
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                    {services.length === 0 && (
                      <p className="text-xs text-slate-600 text-center py-3">No services yet</p>
                    )}
                  </div>
                )}
                <div className="flex gap-2">
                  <input className="input text-sm" value={newService}
                    onChange={e => setNewService(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addService()}
                    placeholder='"NetSuite Consultant", "Salesforce Admin", "SAP Developer"' />
                  <button className="btn-primary flex-shrink-0 px-3" onClick={addService} aria-label="Add service"><Plus size={14} /></button>
                </div>
                <p className="text-xs text-slate-600 mt-2">💡 Be specific — "NetSuite Consultant" beats "ERP"</p>
              </div>
            </SectionCard>

            {/* <SectionCard title="Work Profile" subtitle="Filter by arrangement (optional)">
              <div className="pt-4 flex gap-2 flex-wrap">
                {WORK_TYPES.map(({ label, icon }) => {
                  const active = workTypes.includes(label);
                  return (
                    <button key={label} onClick={() => toggleWorkType(label)}
                      className={cn(
                        'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border transition-all',
                        active ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                               : 'bg-slate-100 dark:bg-slate-950 border-slate-200 dark:border-white/[0.06] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                      )}>
                      <span>{icon}</span>{label}
                      {active && <span className="ml-1 text-blue-400 text-xs">✓</span>}
                    </button>
                  );
                })}
              </div>
            </SectionCard> */}

            <SectionCard title="What You're Offering"
              subtitle="Help AI understand your service to find better-matched leads">
              <div className="pt-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="label mb-1.5">Service name / category</p>
                    <input className="input text-sm" placeholder='e.g. "Digital Marketing", "HR Consulting"'
                      value={serviceName} onChange={e => setServiceName(e.target.value)} />
                  </div>
                  <div>
                    <p className="label mb-1.5">Pricing model</p>
                    <select className="input text-sm" value={pricingModel} onChange={e => setPricingModel(e.target.value)}>
                      <option value="">Select…</option>
                      <option>Monthly retainer</option>
                      <option>Project-based</option>
                      <option>Per hour</option>
                      <option>Revenue share</option>
                      <option>Custom / negotiable</option>
                    </select>
                  </div>
                </div>
                <div>
                  <p className="label mb-1.5">Value proposition / key benefit</p>
                  <textarea className="input text-sm resize-none w-full" rows={3}
                    placeholder="What problem do you solve? What outcome does the client get?"
                    value={valueProp} onChange={e => setValueProp(e.target.value)} />
                </div>
                <div>
                  <p className="label mb-1.5">Keywords / pain points to target</p>
                  <input className="input text-sm" placeholder="e.g. cost reduction, compliance, scalability…"
                    value={keywords} onChange={e => setKeywords(e.target.value)} />
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Decision Maker Targeting"
              subtitle="Contacts for these roles will be fetched automatically via Apollo">
              <div className="pt-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {([
                    'CEO / Founder', 'CTO / CIO', 'CMO', 'CFO',
                    'VP Sales', 'Head of HR', 'Procurement', 'Operations',
                    'Managing Director', 'IT Director', 'Finance Manager',
                  ] as const).map(role => {
                    const active = selectedRoles.includes(role);
                    return (
                      <button key={role} type="button" onClick={() => toggleRole(role)}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                          active
                            ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                            : 'bg-slate-100 dark:bg-slate-950 border-slate-200 dark:border-white/[0.06] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:border-slate-400 dark:hover:border-white/20'
                        )}>
                        <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', active ? 'bg-violet-400' : 'bg-slate-500')} />
                        {role}
                      </button>
                    );
                  })}
                </div>
                {/* Custom role input */}
                <div className="flex gap-2">
                  <input className="input text-xs h-8 flex-1" placeholder='e.g. "ERP Manager", "Plant Manager"'
                    value={customRoleInput}
                    onChange={e => setCustomRoleInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCustomRole()} />
                  <button type="button" className="btn-primary flex-shrink-0 px-3 h-8 text-xs" onClick={addCustomRole}
                    aria-label="Add custom role"><Plus size={12} /></button>
                </div>
                {/* Show custom-added roles */}
                {selectedRoles.filter(r => ![
                  'CEO / Founder','CTO / CIO','CMO','CFO','VP Sales',
                  'Head of HR','Procurement','Operations','Managing Director','IT Director','Finance Manager',
                ].includes(r)).map(r => (
                  <span key={r} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-violet-500/15 border border-violet-500/25 text-violet-300">
                    {r}
                    <button type="button" onClick={() => setSelectedRoles(prev => prev.filter(x => x !== r))}
                      className="hover:text-white transition-colors ml-0.5"><X size={9} /></button>
                  </span>
                ))}
                {selectedRoles.length === 0 && (
                  <p className="text-xs text-slate-500">No roles selected — Apollo will search for default decision makers (CEO, CTO, Founder)</p>
                )}
                {/* Contact channel + seniority */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <p className="label mb-1.5">Contact channel</p>
                    <select className="input text-sm" value={contactChannel} onChange={e => setContactChannel(e.target.value)}>
                      <option value="">Any</option>
                      <option>Email</option>
                      <option>LinkedIn</option>
                      <option>Phone</option>
                      <option>WhatsApp</option>
                    </select>
                  </div>
                  <div>
                    <p className="label mb-1.5">Seniority level</p>
                    <select className="input text-sm" value={seniorityLevel} onChange={e => setSeniorityLevel(e.target.value)}>
                      <option value="">Any</option>
                      <option>C-suite</option>
                      <option>VP / Director</option>
                      <option>Manager</option>
                    </select>
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Target Company Profile" subtitle="Leave blank for any">
              <div className="pt-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="label mb-1.5">Industry</p>
                    <input className="input text-sm" placeholder="e.g. SaaS, Fintech"
                      value={targetIndustry} onChange={e => setTargetIndustry(e.target.value)} />
                  </div>
                  <div>
                    <p className="label mb-1.5">Region</p>
                    <input className="input text-sm" placeholder="e.g. USA, India"
                      value={targetRegion} onChange={e => setTargetRegion(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="label mb-1.5">Company size</p>
                    <select className="input text-sm" value={companySize} onChange={e => setCompanySize(e.target.value)}>
                      <option value="">Any size</option>
                      <option>1–10 (Micro)</option>
                      <option>11–50 (Small)</option>
                      <option>51–200 (Mid-market)</option>
                      <option>201–500</option>
                      <option>500–1000</option>
                      <option>1000+ (Enterprise)</option>
                    </select>
                  </div>
                  <div>
                    <p className="label mb-1.5">Company type</p>
                    <select className="input text-sm" value={companyType} onChange={e => setCompanyType(e.target.value)}>
                      <option value="">Any</option>
                      <option>B2B</option>
                      <option>B2C</option>
                      <option>Government / PSU</option>
                      <option>Non-profit / NGO</option>
                      <option>Startup</option>
                    </select>
                  </div>
                </div>
                <div>
                  <p className="label mb-1.5">
                    Annual revenue range
                    <span className="ml-1.5 text-[10px] text-slate-500 bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-white/[0.06] px-1.5 py-0.5 rounded font-normal">optional</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(['< ₹1 Cr', '₹1–10 Cr', '₹10–100 Cr', '₹100–500 Cr', '₹500 Cr+'] as const).map(r => {
                      const active = revenueRanges.includes(r);
                      return (
                        <button key={r} type="button" onClick={() => toggleRevenueRange(r)}
                          className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                            active
                              ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                              : 'bg-slate-100 dark:bg-slate-950 border-slate-200 dark:border-white/[0.06] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:border-slate-400 dark:hover:border-white/20'
                          )}>
                          <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', active ? 'bg-violet-400' : 'bg-slate-500')} />
                          {r}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Lead Quality Filters" subtitle="Control volume and quality" defaultOpen={false}>
              <div className="pt-4 space-y-4">
                <div>
                  <p className="label mb-2">Number of leads to generate</p>
                  <div className="flex items-center gap-3">
                    <input type="range" min={10} max={500} step={10} value={leadCount}
                      onChange={e => setLeadCount(Number(e.target.value))}
                      className="flex-1 accent-violet-500" />
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 min-w-[72px] text-right">{leadCount} leads</span>
                  </div>
                </div>
                <div>
                  <p className="label mb-2">
                    Min lead score
                    <span className="ml-1.5 text-[10px] text-slate-500 bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-white/[0.06] px-1.5 py-0.5 rounded font-normal">optional</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { label: 'All leads', value: '' },
                      { label: 'Warm (60%+)', value: 'warm' },
                      { label: 'Hot (80%+)', value: 'hot' },
                    ] as const).map(({ label, value }) => {
                      const active = scoreThreshold === value;
                      return (
                        <button key={value} type="button" onClick={() => setScoreThreshold(value)}
                          className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                            active
                              ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                              : 'bg-slate-100 dark:bg-slate-950 border-slate-200 dark:border-white/[0.06] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:border-slate-400 dark:hover:border-white/20'
                          )}>
                          <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', active ? 'bg-violet-400' : 'bg-slate-500')} />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="label mb-1.5">
                    Exclude
                    <span className="ml-1.5 text-[10px] text-slate-500 bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-white/[0.06] px-1.5 py-0.5 rounded font-normal">optional</span>
                  </p>
                  <input className="input text-sm" placeholder="Competitors, existing clients, blacklisted domains…"
                    value={excludeList} onChange={e => setExcludeList(e.target.value)} />
                </div>
              </div>
            </SectionCard>
          </div>

          {/* Right: scan control */}
          <div className="card p-6 flex flex-col min-h-[320px]">
            <h2 className="section-title mb-4">Discovery Control</h2>
            {scanning ? (
              <ScanProgress scanning activeScan={activeScan} scanProgress={scanProgress} color="blue"
                steps={['AI generates job title variants','Google Jobs page 1','Google Jobs page 2','Google Jobs page 3','Filtering agencies','More variants','Deduplicating','Saving leads']} />
            ) : scanComplete ? (
              <ScanComplete activeScan={activeScan} />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600/20 to-cyan-500/10 border border-blue-500/25 flex items-center justify-center">
                  <Target size={28} className="text-blue-400" />
                </div>
                <div>
                  <p className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Ready to Discover Leads</p>
                  <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                    Google Jobs engine finds companies ACTIVELY HIRING for your service.
                    AI generates job title variants — no static lists.
                    {targetRegion ? ` Targeting ${targetRegion}.` : ' Searching worldwide.'}
                  </p>
                </div>
                <button className="btn-primary px-8 py-3 text-sm w-full justify-center"
                  onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending || services.length === 0}>
                  {scanMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
                  Generate Leads
                </button>
                {services.length === 0 && (
                  <p className="text-xs text-amber-400">↑ Add at least one service first</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════ PRODUCT MODE ════════════════════ */}
      {scanMode === 'product' && (
        <div className="space-y-4">

          {/* 3-step indicator */}
          <div className="flex items-center gap-2">
            {[
              { n: '1', label: 'Enter product info',  done: hasProductInputs,                          active: !hasProductInputs },
              { n: '2', label: 'Review AI prompt',     done: promptGenerated,                           active: hasProductInputs && !promptGenerated },
              { n: '3', label: 'Start scan',           done: false,                                     active: promptGenerated && !scanning },
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

            {/* Left: inputs */}
            <div className="space-y-4">
              <SectionCard title="Product Information"
                subtitle="Works for ANY product — software, toy, machine, equipment, service, anything">
                <div className="pt-5 space-y-6">

                  {/* URL */}
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
                        <a href={productUrl} target="_blank" rel="noreferrer" className="btn-ghost flex-shrink-0 px-2.5">
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

                  {/* Description */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/25 flex items-center justify-center flex-shrink-0">
                        <AlignLeft size={13} className="text-violet-400" />
                      </div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Product Description</p>
                      <span className="text-[10px] bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-white/[0.06] text-slate-500 px-1.5 py-0.5 rounded font-medium">OPTIONAL</span>
                    </div>
                    <textarea className="input text-sm resize-none w-full" rows={5}
                      placeholder="Describe your product: what it is, who needs it, problems it solves, features, use cases…"
                      value={productDescription}
                      onChange={e => { setProductDescription(e.target.value); resetPrompt(); }} />
                    <p className="text-xs text-slate-600 mt-1.5">{productDescription.length}/3000 chars</p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-slate-200 dark:bg-white/[0.06]" />
                    <span className="text-[10px] text-slate-600 font-semibold tracking-widest">AND / OR</span>
                    <div className="flex-1 h-px bg-slate-200 dark:bg-white/[0.06]" />
                  </div>

                  {/* Document upload */}
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
                        <p className="text-xs text-slate-500 line-clamp-2">{productDocumentText.slice(0, 180)}…</p>
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

              <SectionCard title="Target Filters" subtitle="Leave blank for worldwide">
                <div className="pt-4 grid grid-cols-2 gap-3">
                  <div>
                    <p className="label mb-1.5">Industry</p>
                    <input className="input text-sm" placeholder="e.g. Construction, SaaS"
                      value={targetIndustry} onChange={e => { setTargetIndustry(e.target.value); resetPrompt(); }} />
                  </div>
                  <div>
                    <p className="label mb-1.5">Region</p>
                    <input className="input text-sm" placeholder="e.g. USA, India"
                      value={targetRegion} onChange={e => { setTargetRegion(e.target.value); resetPrompt(); }} />
                  </div>
                </div>
              </SectionCard>

              {/* Generate Prompt button — only shown before prompt is generated */}
              {!promptGenerated && (
                <>
                  <button
                    className="btn-primary w-full py-3 text-sm justify-center"
                    onClick={() => generatePromptMutation.mutate()}
                    disabled={!hasProductInputs || generatePromptMutation.isPending}>
                    {generatePromptMutation.isPending
                      ? <><Loader2 size={14} className="animate-spin" /> AI analyzing your product…</>
                      : <><Sparkles size={14} /> Generate Discovery Prompt</>}
                  </button>
                  {!hasProductInputs && (
                    <p className="text-xs text-amber-400 text-center">↑ Add a URL, description, or document first</p>
                  )}
                </>
              )}
            </div>

            {/* Right: prompt preview or scan panel */}
            <div className="space-y-4">

              {/* Scan in progress / complete */}
              {(scanning || scanComplete) && (
                <div className="card p-6">
                  <h2 className="section-title mb-4">
                    {scanComplete ? 'Scan Complete' : 'Product Scan in Progress'}
                  </h2>
                  {scanComplete ? (
                    <ScanComplete activeScan={activeScan} />
                  ) : (
                    <ScanProgress scanning activeScan={activeScan} scanProgress={scanProgress} color="violet"
                      steps={['AI call — analyzing product','AI batch scoring','Filtering competitors','Deduplicating','Saving leads']} />
                  )}
                </div>
              )}

              {/* AI Prompt preview — shown after generation, before scan */}
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
                            promptBuyerType === 'B2B'  ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
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

                  {/* Editable textarea */}
                  <div className="relative">
                    <textarea
                      className="input text-xs leading-relaxed resize-none w-full font-mono"
                      rows={18}
                      value={promptText}
                      onChange={e => { setPromptText(e.target.value); setPromptEdited(true); }}
                      placeholder="AI prompt will appear here…"
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
                    disabled={!canStartProductScan || productScanMutation.isPending}>
                    {productScanMutation.isPending
                      ? <><Loader2 size={14} className="animate-spin" /> Starting scan…</>
                      : <><Zap size={14} /> Generate Leads</>}
                  </button>
                </div>
              )}

              {/* Idle — waiting for user to generate prompt */}
              {!promptGenerated && !scanning && !scanComplete && (
                <div className="card p-6 flex flex-col items-center justify-center text-center gap-4 min-h-[300px]">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600/20 to-blue-500/10 border border-violet-500/25 flex items-center justify-center">
                    <Sparkles size={26} className="text-violet-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-200 mb-1">AI Prompt Preview</p>
                    <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                      Fill in your product details, then click{' '}
                      <span className="text-violet-400 font-medium">Generate Discovery Prompt</span>.
                      AI will build a targeting strategy you can review and edit before scanning.
                    </p>
                  </div>
                  <div className="space-y-2 w-full text-left">
                    {[
                      { icon: '🎯', text: 'Identifies who NEEDS your product' },
                      { icon: '🔍', text: 'Generates search keywords & queries' },
                      { icon: '✏️', text: 'You review & edit before scanning' },
                      { icon: '🚀', text: 'Scan runs with your approved prompt' },
                    ].map(({ icon, text }) => (
                      <div key={text} className="flex items-center gap-2.5 bg-slate-100 dark:bg-slate-950 rounded-lg px-3 py-2">
                        <span className="text-sm">{icon}</span>
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
                      scan.status === 'running'   ? 'blue'  :
                      scan.status === 'failed'    ? 'red'   : 'gray'
                    }>{scan.status}</Badge>
                    <span className={cn('text-xs rounded px-1.5 py-0.5 border',
                      isProduct ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                                : 'bg-blue-500/10 text-blue-400 border-blue-500/20')}>
                      {isProduct ? 'product' : 'service'}
                    </span>
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{scan.leadsFound ?? 0} leads</span>
                    {scan.targetRegion && <span className="text-xs text-slate-500">· {scan.targetRegion}</span>}
                    {!isProduct && (scan.services ?? []).length > 0 && (
                      <span className="text-xs text-slate-500 truncate hidden sm:inline">
                        · {(scan.services as string[]).slice(0, 2).join(', ')}
                      </span>
                    )}
                    {isProduct && scan.sources?.productDescriptionSnippet && (
                      <span className="text-xs text-slate-500 truncate hidden sm:inline">
                        · {scan.sources.productDescriptionSnippet.slice(0, 50)}
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

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-components
// ─────────────────────────────────────────────────────────────────────────────

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
            {color === 'violet' ? 'Finding buyer companies…' : 'Scanning for leads…'}
          </span>
          <span className={`ml-auto text-xs text-${color}-400 font-mono`}>{scanProgress}%</span>
        </div>
        <ProgressBar value={scanProgress} color="blue" />
        <p className={`text-xs text-${color}-400 mt-2`}>{activeScan?.leadsFound ?? 0} leads found so far</p>
      </div>
      <div className="space-y-2">
        {steps.map((step, i) => {
          const threshold = (i + 1) / steps.length * 100;
          const done   = scanProgress >= threshold;
          const active = !done && scanProgress >= threshold - (100 / steps.length);
          return (
            <div key={i} className={cn2('flex items-center gap-2 text-xs transition-all',
              done ? 'text-emerald-400' : active ? `text-${color}-400` : 'text-slate-600')}>
              {done   ? <CheckCircle2 size={11} className="flex-shrink-0" />
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

function ScanComplete({ activeScan }: { activeScan: any }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-4 py-4">
      <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
        <CheckCircle2 size={30} className="text-emerald-400" />
      </div>
      <div>
        <p className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Scan Complete!</p>
        <p className="text-3xl font-bold text-emerald-400">{activeScan?.leadsFound ?? 0}</p>
        <p className="text-sm text-slate-500 mt-1">new leads discovered</p>
      </div>
      <a href="/dashboard/leads" className="btn-primary text-sm px-6 py-2.5 w-full justify-center">
        <Users size={14} /> View All Leads →
      </a>
    </div>
  );
}