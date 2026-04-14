'use client';
import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { discoveryApi } from '../../../lib/api';
import { Badge, ProgressBar, Spinner } from '../../../components/ui';
import {
  Plus, X, Zap, Loader2, CheckCircle2,
  Link2, FileText, AlignLeft, Package, Briefcase,
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

  const [scanMode, setScanMode] = useState<'service' | 'product'>('service');

  // Service mode
  const [newService,     setNewService]     = useState('');
  const [workTypes,      setWorkTypes]      = useState<string[]>([]);
  const [targetIndustry, setTargetIndustry] = useState('');
  const [targetRegion,   setTargetRegion]   = useState('');

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
    mutationFn: () => discoveryApi.startScan({ targetIndustry, targetRegion, workTypes }),
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
        <div className="flex items-center gap-3">
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
        </div>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-2">
        {([
          { mode: 'service' as const, icon: <Briefcase size={14} />, label: 'Service / Position' },
          { mode: 'product' as const, icon: <Package   size={14} />, label: 'Product Discovery'  },
        ] as const).map(({ mode, icon, label }) => (
          <button key={mode} onClick={() => setScanMode(mode)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border transition-all',
              scanMode === mode
                ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                : 'bg-slate-100 dark:bg-slate-950 border-slate-200 dark:border-white/[0.06] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:border-slate-400 dark:hover:border-white/20'
            )}>
            {icon}{label}
          </button>
        ))}
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
                  <button className="btn-primary flex-shrink-0 px-3" onClick={addService}><Plus size={14} /></button>
                </div>
                <p className="text-xs text-slate-600 mt-2">💡 Be specific — "NetSuite Consultant" beats "ERP"</p>
              </div>
            </SectionCard>

            <SectionCard title="Work Profile" subtitle="Filter by arrangement (optional)">
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
            </SectionCard>

            <SectionCard title="Target Filters" subtitle="Leave blank for worldwide">
              <div className="pt-4 grid grid-cols-2 gap-3">
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
                  Launch AI Scan
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
                      onChange={handleFileUpload} className="hidden" />
                    {productDocumentText ? (
                      <div className="bg-slate-100 dark:bg-slate-950 rounded-xl p-3 border border-emerald-500/20">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={13} className="text-emerald-400" />
                            <span className="text-xs text-emerald-400 font-medium">{productFileName}</span>
                          </div>
                          <button onClick={() => { setProductDocumentText(''); setProductFileName(''); resetPrompt(); }}
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
                      : <><Zap size={14} /> Start Product Scan</>}
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