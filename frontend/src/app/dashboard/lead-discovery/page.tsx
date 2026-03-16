// 'use client';
// import { useState, useEffect, useRef } from 'react';
// import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
// import { discoveryApi } from '../../../lib/api';
// import { Badge, ProgressBar, Spinner } from '../../../components/ui';
// import {
//   Plus, X, Zap, Loader2, CheckCircle2, Globe,
//   Link2, FileText, AlignLeft, Package, Briefcase,
//   ChevronDown, ChevronUp, Upload, ExternalLink,
//   TrendingUp, Target, Users, Search,
// } from 'lucide-react';
// import toast from 'react-hot-toast';
// import { formatDate } from '../../../lib/utils';

// // ─────────────────────────────────────────────────────────────────────────────
// // Constants
// // ─────────────────────────────────────────────────────────────────────────────

// const WORK_TYPES = [
//   { label: 'On-site', icon: '🏢' },
//   { label: 'Remote',  icon: '🏠' },
//   { label: 'Hybrid',  icon: '🔀' },
// ];

// const DEFAULT_SOURCES = [
//   'LinkedIn', 'Job Boards', 'Crunchbase',
//   'Tech Stack (BuiltWith)', 'News & Press',
//   'Reddit/Forums', 'GitHub', 'AngelList',
// ];

// const SCAN_STEPS = [
//   'Scanning LinkedIn job postings & company pages',
//   'Checking Indeed, Glassdoor & job boards',
//   'Finding decision-maker profiles',
//   'Checking Crunchbase funding signals',
//   'Scanning Reddit & developer communities',
//   'Analyzing GitHub & tech signals',
//   'Processing news & press releases',
//   'Cross-referencing intent signals',
//   'Deduplicating & scoring leads',
// ];

// const ACTIVE_SCAN_KEY = 'lf_active_scan_id';

// function cn(...cls: (string | boolean | undefined | null)[]) {
//   return cls.filter(Boolean).join(' ');
// }
// function loadSources(): string[] {
//   try { const s = localStorage.getItem('discovery_sources'); if (s) return JSON.parse(s); }
//   catch {}
//   return DEFAULT_SOURCES;
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // SectionCard
// // ─────────────────────────────────────────────────────────────────────────────

// function SectionCard({
//   title, subtitle, defaultOpen = true, children,
// }: { title: string; subtitle?: string; defaultOpen?: boolean; children: React.ReactNode }) {
//   const [open, setOpen] = useState(defaultOpen);
//   return (
//     <div className="card overflow-hidden">
//       <button type="button" onClick={() => setOpen(o => !o)}
//         className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-800/20 transition-colors text-left">
//         <div>
//           <p className="text-sm font-semibold text-slate-200">{title}</p>
//           {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
//         </div>
//         {open ? <ChevronUp size={14} className="text-slate-500 flex-shrink-0" />
//               : <ChevronDown size={14} className="text-slate-500 flex-shrink-0" />}
//       </button>
//       {open && <div className="px-5 pb-5 border-t border-white/[0.04]">{children}</div>}
//     </div>
//   );
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // Main Page
// // ─────────────────────────────────────────────────────────────────────────────

// export default function LeadDiscoveryPage() {
//   const qc = useQueryClient();

//   // ── Mode ─────────────────────────────────────────────────────────────────
//   const [scanMode, setScanMode] = useState<'service' | 'product'>('service');

//   // ── Service mode ─────────────────────────────────────────────────────────
//   const [newService, setNewService]         = useState('');
//   const [workTypes,  setWorkTypes]          = useState<string[]>([]);
//   const [sources,    setSources]            = useState<string[]>(DEFAULT_SOURCES);
//   const [newSource,  setNewSource]          = useState('');
//   const [targetIndustry, setTargetIndustry] = useState('');
//   const [targetRegion,   setTargetRegion]   = useState('');

//   // ── Product mode — ALL THREE inputs shown stacked (no tabs) ──────────────
//   const [productUrl,          setProductUrl]          = useState('');
//   const [productDescription,  setProductDescription]  = useState('');
//   const [productDocumentText, setProductDocumentText] = useState('');
//   const [productFileName,     setProductFileName]     = useState('');
//   const fileInputRef = useRef<HTMLInputElement>(null);

//   // ── Scan state ───────────────────────────────────────────────────────────
//   const [activeScanId,        setActiveScanId]        = useState<string | null>(null);
//   const [optimisticProgress,  setOptimisticProgress]  = useState(0);

//   // ── Restore ───────────────────────────────────────────────────────────────
//   useEffect(() => {
//     setSources(loadSources());
//     const stored = localStorage.getItem(ACTIVE_SCAN_KEY);
//     if (stored) setActiveScanId(stored);
//   }, []);
//   useEffect(() => {
//     if (activeScanId) localStorage.setItem(ACTIVE_SCAN_KEY, activeScanId);
//     else              localStorage.removeItem(ACTIVE_SCAN_KEY);
//   }, [activeScanId]);
//   useEffect(() => {
//     localStorage.setItem('discovery_sources', JSON.stringify(sources));
//   }, [sources]);

//   // ── Server-side active scan restore ──────────────────────────────────────
//   const { data: serverActiveScan } = useQuery({
//     queryKey: ['activeScan'],
//     queryFn:  () => discoveryApi.getActiveScan().then(r => r.data.data),
//     staleTime: 0, refetchOnWindowFocus: false,
//   });
//   useEffect(() => {
//     if (!activeScanId && serverActiveScan?.id) setActiveScanId(serverActiveScan.id);
//   }, [serverActiveScan, activeScanId]);

//   // ── Data ──────────────────────────────────────────────────────────────────
//   const { data: servicesData, isLoading: servicesLoading } = useQuery({
//     queryKey: ['services'],
//     queryFn:  () => discoveryApi.getServices().then(r => r.data.data),
//   });
//   const { data: scansData } = useQuery({
//     queryKey: ['scans'],
//     queryFn:  () => discoveryApi.getScans().then(r => ({
//       items: Array.isArray(r.data.data) ? r.data.data : (r.data.data?.items ?? []),
//     })),
//   });

//   // ── Live poll ─────────────────────────────────────────────────────────────
//   const { data: activeScan } = useQuery({
//     queryKey: ['scan', activeScanId],
//     queryFn:  () => activeScanId
//       ? discoveryApi.getScanStatus(activeScanId).then(r => r.data.data)
//       : null,
//     enabled:        !!activeScanId,
//     refetchInterval: activeScanId ? 2000 : false,
//   });
//   useEffect(() => {
//     if (activeScan?.status === 'completed' || activeScan?.status === 'failed') {
//       const t = setTimeout(() => {
//         setActiveScanId(null);
//         setOptimisticProgress(0);
//         qc.invalidateQueries({ queryKey: ['scans'] });
//         qc.invalidateQueries({ queryKey: ['activeScan'] });
//       }, 6000);
//       return () => clearTimeout(t);
//     }
//   }, [activeScan?.status]);

//   // ── Service management ────────────────────────────────────────────────────
//   const updateServicesMutation = useMutation({
//     mutationFn: (s: any[]) => discoveryApi.updateServices(s),
//     onSuccess:  () => qc.invalidateQueries({ queryKey: ['services'] }),
//   });
//   const services: any[] = servicesData ?? [];

//   function addService() {
//     if (!newService.trim()) return;
//     updateServicesMutation.mutate([...services, { name: newService.trim(), isActive: true }]);
//     setNewService('');
//   }
//   function removeService(i: number) {
//     updateServicesMutation.mutate(services.filter((_: any, j: number) => j !== i));
//   }
//   function toggleWorkType(wt: string) {
//     setWorkTypes(prev => prev.includes(wt) ? prev.filter(w => w !== wt) : [...prev, wt]);
//   }
//   function addSource() {
//     const t = newSource.trim();
//     if (!t || sources.includes(t)) return;
//     setSources(prev => [...prev, t]);
//     setNewSource('');
//   }
//   function removeSource(i: number) { setSources(prev => prev.filter((_, j) => j !== i)); }

//   // ── File upload ───────────────────────────────────────────────────────────
//   function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
//     const file = e.target.files?.[0];
//     if (!file) return;
//     setProductFileName(file.name);
//     const reader = new FileReader();
//     reader.onload = ev => setProductDocumentText((ev.target?.result as string) || '');
//     reader.readAsText(file);
//     toast.success(`"${file.name}" loaded`);
//   }

//   // ── Progress ──────────────────────────────────────────────────────────────
//   function startOptimisticProgress() {
//     setOptimisticProgress(0);
//     let v = 0;
//     const iv = setInterval(() => { v += 2; setOptimisticProgress(v); if (v >= 10) clearInterval(iv); }, 600);
//   }

//   // ── Mutations ─────────────────────────────────────────────────────────────
//   const scanMutation = useMutation({
//     mutationFn: () => discoveryApi.startScan({ targetIndustry, targetRegion, workTypes, sources }),
//     onSuccess: res => {
//       const id = res.data.data.id ?? res.data.data.jobId;
//       setActiveScanId(id);
//       toast.success('Scan started — searching worldwide!');
//       qc.invalidateQueries({ queryKey: ['scans'] });
//       startOptimisticProgress();
//     },
//     onError: () => toast.error('Failed to start scan'),
//   });

//   const productScanMutation = useMutation({
//     mutationFn: () => {
//       // Pick whichever input was filled — priority: url > document > description
//       let productType = 'description';
//       if (productUrl.trim())            productType = 'url';
//       else if (productDocumentText.trim()) productType = 'document';

//       return discoveryApi.startProductScan({
//         productType,
//         productUrl:          productUrl.trim()          || undefined,
//         productDescription:  productDescription.trim()  || undefined,
//         productDocumentText: productDocumentText.trim() || undefined,
//         targetIndustry, targetRegion, workTypes, sources,
//       });
//     },
//     onSuccess: res => {
//       const id = res.data.data.id ?? res.data.data.jobId;
//       setActiveScanId(id);
//       toast.success('Product scan started!');
//       qc.invalidateQueries({ queryKey: ['scans'] });
//       startOptimisticProgress();
//     },
//     onError: () => toast.error('Failed to start product scan'),
//   });

//   // ── Derived ───────────────────────────────────────────────────────────────
//   const isMutating = scanMutation.isPending || productScanMutation.isPending;
//   const scanning = isMutating || (
//     !!activeScanId &&
//     (activeScan == null || activeScan?.status === 'running' || activeScan?.status === 'pending')
//   );
//   const scanProgress = (activeScan?.progress != null && activeScan.progress > 0)
//     ? activeScan.progress : optimisticProgress;
//   const scanComplete = activeScan?.status === 'completed';

//   const canLaunchService = services.length > 0;
//   const canLaunchProduct = productUrl.trim().length > 0
//     || productDescription.trim().length > 10
//     || productDocumentText.trim().length > 10;
//   const canLaunch = scanMode === 'service' ? canLaunchService : canLaunchProduct;

//   function launchScan() {
//     if (scanMode === 'service') scanMutation.mutate();
//     else productScanMutation.mutate();
//   }

//   const totalLeadsEver = (scansData?.items ?? [])
//     .reduce((s: number, j: any) => s + (j.leadsFound ?? 0), 0);

//   // ─────────────────────────────────────────────────────────────────────────
//   return (
//     <div className="space-y-5">

//       {/* Header */}
//       <div className="flex items-start justify-between gap-3 flex-wrap">
//         <div>
//           <h1 className="page-title">Lead Discovery Engine</h1>
//           <p className="text-sm text-slate-500 mt-1">
//             Scan the internet to find 100–1000+ companies that need your service worldwide
//           </p>
//         </div>
//         <div className="flex items-center gap-3">
//           {totalLeadsEver > 0 && (
//             <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-900 border border-white/[0.06] rounded-xl px-3 py-2">
//               <TrendingUp size={12} className="text-emerald-400" />
//               {totalLeadsEver.toLocaleString()} total discovered
//             </div>
//           )}
//           <button className="btn-primary px-6 py-2.5 text-sm" onClick={launchScan}
//             disabled={scanning || !canLaunch}>
//             {scanning
//               ? <><Loader2 size={14} className="animate-spin" /> Scanning…</>
//               : <><Zap size={14} /> Launch AI Scan</>}
//           </button>
//         </div>
//       </div>

//       {/* Mode tabs */}
//       <div className="flex gap-2">
//         {([
//           { mode: 'service' as const, icon: <Briefcase size={14} />, label: 'Service / Position' },
//           { mode: 'product' as const, icon: <Package   size={14} />, label: 'Product Discovery'  },
//         ] as const).map(({ mode, icon, label }) => (
//           <button key={mode} onClick={() => setScanMode(mode)}
//             className={cn(
//               'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border transition-all',
//               scanMode === mode
//                 ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
//                 : 'bg-slate-950 border-white/[0.06] text-slate-400 hover:text-slate-200 hover:border-white/20'
//             )}>
//             {icon}{label}
//           </button>
//         ))}
//       </div>

//       <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

//         {/* ── Left column ────────────────────────────────────────────────── */}
//         <div className="space-y-4">

//           {/* ════ SERVICE MODE ════ */}
//           {scanMode === 'service' && (<>

//             <SectionCard title="Services / Positions"
//               subtitle="AI finds companies actively hiring or needing these services — be specific for best results">
//               <div className="pt-4">
//                 {servicesLoading ? <Spinner /> : (
//                   <div className="space-y-2 mb-3">
//                     {services.map((s: any, i: number) => (
//                       <div key={i} className="flex items-center justify-between bg-slate-950 rounded-xl px-3 py-2.5 group">
//                         <div className="flex items-center gap-2">
//                           <CheckCircle2 size={13} className="text-emerald-400" />
//                           <span className="text-sm text-slate-200">{s.name}</span>
//                         </div>
//                         <button onClick={() => removeService(i)}
//                           className="text-slate-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">
//                           <X size={13} />
//                         </button>
//                       </div>
//                     ))}
//                     {services.length === 0 && (
//                       <p className="text-xs text-slate-600 text-center py-3">No services yet — add one to begin</p>
//                     )}
//                   </div>
//                 )}
//                 <div className="flex gap-2">
//                   <input className="input text-sm" value={newService}
//                     onChange={e => setNewService(e.target.value)}
//                     onKeyDown={e => e.key === 'Enter' && addService()}
//                     placeholder='e.g. "NetSuite Consultant", "Salesforce Admin", "SAP Developer"' />
//                   <button className="btn-primary flex-shrink-0 px-3" onClick={addService}><Plus size={14} /></button>
//                 </div>
//                 <p className="text-xs text-slate-600 mt-2">
//                   💡 Specific = more leads. "NetSuite Consultant" beats just "ERP"
//                 </p>
//               </div>
//             </SectionCard>

//             <SectionCard title="Work Profile" subtitle="Filter by work arrangement (optional)">
//               <div className="pt-4 flex gap-2 flex-wrap">
//                 {WORK_TYPES.map(({ label, icon }) => {
//                   const active = workTypes.includes(label);
//                   return (
//                     <button key={label} onClick={() => toggleWorkType(label)}
//                       className={cn(
//                         'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border transition-all',
//                         active
//                           ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
//                           : 'bg-slate-950 border-white/[0.06] text-slate-400 hover:text-slate-200 hover:border-white/20'
//                       )}>
//                       <span>{icon}</span>{label}
//                       {active && <span className="ml-1 text-blue-400 text-xs">✓</span>}
//                     </button>
//                   );
//                 })}
//                 {workTypes.length === 0 && (
//                   <p className="text-xs text-slate-600 mt-1 w-full">No filter — all arrangements (wider net)</p>
//                 )}
//               </div>
//             </SectionCard>

//             <SectionCard title="Target Filters"
//               subtitle="Leave blank for worldwide — recommended for maximum lead volume">
//               <div className="pt-4 grid grid-cols-2 gap-3">
//                 <div>
//                   <p className="label mb-1.5">Industry</p>
//                   <input className="input text-sm" placeholder="e.g. SaaS, Fintech, Retail"
//                     value={targetIndustry} onChange={e => setTargetIndustry(e.target.value)} />
//                 </div>
//                 <div>
//                   <p className="label mb-1.5">Region</p>
//                   <input className="input text-sm" placeholder="e.g. USA, India, Europe"
//                     value={targetRegion} onChange={e => setTargetRegion(e.target.value)} />
//                 </div>
//               </div>
//             </SectionCard>
//           </>)}

//           {/* ════ PRODUCT MODE — stacked, no tabs ════ */}
//           {scanMode === 'product' && (<>

//             <SectionCard title="Product Information"
//               subtitle="Fill any combination — AI uses all inputs together for better targeting">
//               <div className="pt-5 space-y-6">

//                 {/* ── 1. URL ── */}
//                 <div>
//                   <div className="flex items-center gap-2 mb-2">
//                     <div className="w-7 h-7 rounded-lg bg-blue-500/15 border border-blue-500/25 flex items-center justify-center flex-shrink-0">
//                       <Link2 size={13} className="text-blue-400" />
//                     </div>
//                     <p className="text-sm font-semibold text-slate-200">Product URL</p>
//                     <span className="text-[10px] bg-slate-800 border border-white/[0.06] text-slate-500 px-1.5 py-0.5 rounded font-medium tracking-wide">OPTIONAL</span>
//                   </div>
//                   <div className="flex gap-2">
//                     <input className="input text-sm flex-1" placeholder="https://yourproduct.com"
//                       value={productUrl} onChange={e => setProductUrl(e.target.value)} />
//                     {productUrl && (
//                       <a href={productUrl} target="_blank" rel="noreferrer"
//                         className="btn-ghost flex-shrink-0 px-2.5"><ExternalLink size={13} /></a>
//                     )}
//                   </div>
//                   <p className="text-xs text-slate-600 mt-1.5">
//                     AI fetches your landing page to understand what you offer
//                   </p>
//                 </div>

//                 {/* Divider */}
//                 <div className="flex items-center gap-3">
//                   <div className="flex-1 h-px bg-white/[0.06]" />
//                   <span className="text-[10px] text-slate-600 font-semibold tracking-widest">AND / OR</span>
//                   <div className="flex-1 h-px bg-white/[0.06]" />
//                 </div>

//                 {/* ── 2. Description ── */}
//                 <div>
//                   <div className="flex items-center gap-2 mb-2">
//                     <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/25 flex items-center justify-center flex-shrink-0">
//                       <AlignLeft size={13} className="text-violet-400" />
//                     </div>
//                     <p className="text-sm font-semibold text-slate-200">Product Description</p>
//                     <span className="text-[10px] bg-slate-800 border border-white/[0.06] text-slate-500 px-1.5 py-0.5 rounded font-medium tracking-wide">OPTIONAL</span>
//                   </div>
//                   <textarea className="input text-sm resize-none w-full" rows={5}
//                     placeholder="Describe your product: what it does, who it's for, problems it solves, key features, use cases…"
//                     value={productDescription}
//                     onChange={e => setProductDescription(e.target.value)} />
//                   <p className="text-xs text-slate-600 mt-1.5">
//                     {productDescription.length}/3000 chars — more detail = better lead targeting
//                   </p>
//                 </div>

//                 {/* Divider */}
//                 <div className="flex items-center gap-3">
//                   <div className="flex-1 h-px bg-white/[0.06]" />
//                   <span className="text-[10px] text-slate-600 font-semibold tracking-widest">AND / OR</span>
//                   <div className="flex-1 h-px bg-white/[0.06]" />
//                 </div>

//                 {/* ── 3. Document upload ── */}
//                 <div>
//                   <div className="flex items-center gap-2 mb-2">
//                     <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center flex-shrink-0">
//                       <FileText size={13} className="text-emerald-400" />
//                     </div>
//                     <p className="text-sm font-semibold text-slate-200">Upload Brochure / Spec Sheet</p>
//                     <span className="text-[10px] bg-slate-800 border border-white/[0.06] text-slate-500 px-1.5 py-0.5 rounded font-medium tracking-wide">OPTIONAL</span>
//                   </div>

//                   <input ref={fileInputRef} type="file" accept=".txt,.md,.csv,.pdf"
//                     onChange={handleFileUpload} className="hidden" />

//                   {productDocumentText ? (
//                     <div className="bg-slate-950 rounded-xl p-3 border border-emerald-500/20">
//                       <div className="flex items-center justify-between mb-1.5">
//                         <div className="flex items-center gap-2">
//                           <CheckCircle2 size={13} className="text-emerald-400" />
//                           <span className="text-xs text-emerald-400 font-medium">{productFileName}</span>
//                         </div>
//                         <button onClick={() => { setProductDocumentText(''); setProductFileName(''); }}
//                           className="text-slate-600 hover:text-red-400 transition-colors">
//                           <X size={12} />
//                         </button>
//                       </div>
//                       <p className="text-xs text-slate-500 line-clamp-2">
//                         {productDocumentText.slice(0, 180)}…
//                       </p>
//                     </div>
//                   ) : (
//                     <button type="button" onClick={() => fileInputRef.current?.click()}
//                       className="w-full border-2 border-dashed border-white/[0.08] hover:border-emerald-500/30 rounded-xl p-5 text-center transition-colors group">
//                       <Upload size={20} className="mx-auto mb-2 text-slate-600 group-hover:text-emerald-400 transition-colors" />
//                       <p className="text-sm text-slate-400 group-hover:text-slate-300">
//                         Click to upload .txt, .md, or .pdf
//                       </p>
//                       <p className="text-xs text-slate-600 mt-1">Max 5 MB</p>
//                     </button>
//                   )}
//                   <p className="text-xs text-slate-600 mt-1.5">
//                     Upload a one-pager, brochure, or spec sheet
//                   </p>
//                 </div>
//               </div>
//             </SectionCard>

//             <SectionCard title="Target Filters" subtitle="Leave blank for worldwide">
//               <div className="pt-4 grid grid-cols-2 gap-3">
//                 <div>
//                   <p className="label mb-1.5">Industry</p>
//                   <input className="input text-sm" placeholder="e.g. SaaS, Retail"
//                     value={targetIndustry} onChange={e => setTargetIndustry(e.target.value)} />
//                 </div>
//                 <div>
//                   <p className="label mb-1.5">Region</p>
//                   <input className="input text-sm" placeholder="e.g. USA, India"
//                     value={targetRegion} onChange={e => setTargetRegion(e.target.value)} />
//                 </div>
//               </div>
//             </SectionCard>
//           </>)}
//         </div>

//         {/* ── Right column ─────────────────────────────────────────────────── */}
//         <div className="space-y-4">

//           {/* Scan control panel */}
//           <div className="card p-6 flex flex-col min-h-[330px]">
//             <h2 className="section-title mb-4">Discovery Control</h2>

//             {scanning ? (
//               <div className="flex-1 space-y-4">
//                 <div className="p-4 bg-blue-500/[0.06] border border-blue-500/20 rounded-xl">
//                   <div className="flex items-center gap-2 mb-3">
//                     <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
//                     <span className="text-sm font-semibold text-blue-300">
//                       {activeScan?.sources?.scanType === 'product'
//                         ? 'Analyzing product & finding buyers…'
//                         : 'Scanning worldwide for leads…'}
//                     </span>
//                     <span className="ml-auto text-xs text-blue-400 font-mono">{scanProgress}%</span>
//                   </div>
//                   <ProgressBar value={scanProgress} color="blue" />
//                   <p className="text-xs text-blue-400 mt-2">
//                     {activeScan?.leadsFound ?? 0} leads found so far
//                   </p>
//                 </div>

//                 <div className="space-y-2">
//                   {SCAN_STEPS.map((step, i) => {
//                     const threshold = (i + 1) / SCAN_STEPS.length * 100;
//                     const done      = scanProgress >= threshold;
//                     const active    = !done && scanProgress >= threshold - (100 / SCAN_STEPS.length);
//                     return (
//                       <div key={i} className={cn(
//                         'flex items-center gap-2 text-xs transition-all',
//                         done ? 'text-emerald-400' : active ? 'text-blue-400' : 'text-slate-600'
//                       )}>
//                         {done   ? <CheckCircle2 size={11} className="flex-shrink-0" />
//                           : active ? <Loader2 size={11} className="animate-spin flex-shrink-0" />
//                           : <span className="w-3 text-center flex-shrink-0">○</span>}
//                         {step}
//                       </div>
//                     );
//                   })}
//                 </div>
//                 <p className="text-xs text-slate-600 text-center pt-1">
//                   Progress saved — safe to navigate away and return
//                 </p>
//               </div>

//             ) : scanComplete ? (
//               <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
//                 <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
//                   <CheckCircle2 size={30} className="text-emerald-400" />
//                 </div>
//                 <div>
//                   <p className="font-semibold text-slate-200 mb-1">Scan Complete!</p>
//                   <p className="text-3xl font-bold text-emerald-400">{activeScan.leadsFound}</p>
//                   <p className="text-sm text-slate-500 mt-1">new leads discovered</p>
//                 </div>
//                 <div className="p-3 bg-slate-900 rounded-xl border border-white/[0.06] text-left w-full">
//                   <p className="text-xs text-slate-400 font-semibold mb-1">Next step →</p>
//                   <p className="text-xs text-slate-500">
//                     Open any lead in the CRM and click{' '}
//                     <span className="text-emerald-400 font-medium">Find via SignalHire</span> or{' '}
//                     <span className="text-violet-400 font-medium">Search Apollo</span>{' '}
//                     to get contact details on demand.
//                   </p>
//                 </div>
//                 <a href="/dashboard/leads" className="btn-primary text-sm px-6 py-2.5 w-full justify-center">
//                   <Users size={14} /> View All Leads →
//                 </a>
//               </div>

//             ) : (
//               <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
//                 <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600/20 to-cyan-500/10 border border-blue-500/25 flex items-center justify-center">
//                   {scanMode === 'product'
//                     ? <Package size={28} className="text-blue-400" />
//                     : <Target  size={28} className="text-blue-400" />}
//                 </div>
//                 <div>
//                   <p className="font-semibold text-slate-200 mb-1">
//                     {scanMode === 'product' ? 'Ready for Product Scan' : 'Ready to Discover Leads'}
//                   </p>
//                   <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
//                     {scanMode === 'product'
//                       ? 'AI analyzes your inputs and finds companies actively searching for similar solutions'
//                       : `Uses 30+ search patterns across ${sources.length} sources${targetRegion ? ` in ${targetRegion}` : ' worldwide'} — targeting 100–1000+ leads`}
//                   </p>
//                 </div>
//                 <button className="btn-primary px-8 py-3 text-sm w-full justify-center"
//                   onClick={launchScan} disabled={isMutating || !canLaunch}>
//                   {isMutating ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
//                   Launch AI Scan
//                 </button>
//                 {!canLaunch && (
//                   <p className="text-xs text-amber-400">
//                     {scanMode === 'service'
//                       ? '↑ Add at least one service or position first'
//                       : '↑ Add a URL, description, or upload a document first'}
//                   </p>
//                 )}
//               </div>
//             )}
//           </div>

//           {/* How it works */}
//           <div className="card p-4">
//             <h3 className="label mb-3">How it works</h3>
//             <div className="space-y-2.5">
//               {[
//                 {
//                   n: '1', color: 'blue',
//                   title: 'Lead Discovery (this scan)',
//                   desc:  '30+ query patterns hit LinkedIn, job boards, Reddit, Crunchbase & more. Saves every matching company as a lead. No SignalHire/Apollo used — scan stays fast & cheap.',
//                 },
//                 {
//                   n: '2', color: 'slate',
//                   title: 'Company info (auto background)',
//                   desc:  'LinkedIn URL, industry, location & description enriched automatically via free sources (Clearbit + Google KG).',
//                 },
//                 {
//                   n: '3', color: 'emerald',
//                   title: 'Contact enrichment (you trigger it)',
//                   desc:  'Go to any lead → click "Find via SignalHire" or "Search Apollo" whenever you want the contact email & phone.',
//                 },
//               ].map(({ n, color, title, desc }) => (
//                 <div key={n} className={`flex items-start gap-3 p-3 bg-slate-950 rounded-xl border border-${color}-500/10`}>
//                   <span className={`w-6 h-6 rounded-full bg-${color}-500/20 text-${color}-400 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5`}>
//                     {n}
//                   </span>
//                   <div>
//                     <p className="text-xs font-semibold text-slate-300 mb-0.5">{title}</p>
//                     <p className="text-[11px] text-slate-500 leading-relaxed">{desc}</p>
//                   </div>
//                 </div>
//               ))}
//             </div>
//           </div>

//           {/* Active filters */}
//           {(workTypes.length > 0 || targetIndustry || targetRegion) && (
//             <div className="card p-4">
//               <h3 className="label mb-3">Active Filters</h3>
//               <div className="flex flex-wrap gap-2">
//                 {workTypes.map(wt => (
//                   <span key={wt} className="bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg px-2.5 py-1 text-xs font-medium">{wt}</span>
//                 ))}
//                 {targetIndustry && <span className="bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-lg px-2.5 py-1 text-xs font-medium">{targetIndustry}</span>}
//                 {targetRegion   && <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-lg px-2.5 py-1 text-xs font-medium">{targetRegion}</span>}
//               </div>
//             </div>
//           )}
//         </div>
//       </div>

//       {/* ── Data Sources ─────────────────────────────────────────────────────── */}
//       <div className="card p-5">
//         <div className="flex items-center justify-between mb-1">
//           <h2 className="section-title">Data Sources</h2>
//           <span className="text-xs text-slate-500">{sources.length} active</span>
//         </div>
//         <p className="text-xs text-slate-500 mb-4">
//           Each source is searched with multiple query patterns per scan for maximum coverage.
//         </p>
//         <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-4">
//           {sources.map((s, i) => (
//             <div key={i} className="group bg-slate-950 rounded-xl p-3 flex items-center justify-between gap-2">
//               <div className="flex items-center gap-2 min-w-0">
//                 <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
//                 <span className="text-xs text-slate-300 truncate">{s}</span>
//               </div>
//               <button onClick={() => removeSource(i)}
//                 className="text-slate-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0">
//                 <X size={12} />
//               </button>
//             </div>
//           ))}
//         </div>
//         <div className="flex gap-2">
//           <input className="input text-sm" value={newSource}
//             onChange={e => setNewSource(e.target.value)}
//             onKeyDown={e => e.key === 'Enter' && addSource()}
//             placeholder="Add custom source (e.g. ProductHunt, G2, Capterra)" />
//           <button className="btn-ghost flex-shrink-0 px-3" onClick={addSource}><Plus size={14} /></button>
//         </div>
//       </div>

//       {/* ── Scan History ─────────────────────────────────────────────────────── */}
//       {(scansData?.items?.length ?? 0) > 0 && (
//         <div className="card p-5">
//           <h2 className="section-title mb-4">Scan History</h2>
//           <div className="space-y-2">
//             {(scansData!.items as any[]).slice(0, 8).map((scan: any) => {
//               const isProduct = scan.sources?.scanType === 'product';
//               const wt = scan.sources?.workTypes as string[] | undefined;
//               return (
//                 <div key={scan.id} className="flex items-center justify-between p-3 bg-slate-950 rounded-xl gap-3">
//                   <div className="flex items-center gap-2 flex-wrap min-w-0">
//                     <Badge color={
//                       scan.status === 'completed' ? 'green' :
//                       scan.status === 'running'   ? 'blue'  :
//                       scan.status === 'failed'    ? 'red'   : 'gray'
//                     }>{scan.status}</Badge>
//                     <span className={cn(
//                       'text-xs rounded px-1.5 py-0.5 border',
//                       isProduct
//                         ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
//                         : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
//                     )}>
//                       {isProduct ? 'product' : 'service'}
//                     </span>
//                     <span className="text-sm font-semibold text-slate-200">
//                       {scan.leadsFound ?? 0} leads
//                     </span>
//                     {wt && wt.length > 0 && (
//                       <span className="text-xs text-slate-500 truncate">· {wt.join(', ')}</span>
//                     )}
//                     {scan.targetRegion && (
//                       <span className="text-xs text-slate-500">· {scan.targetRegion}</span>
//                     )}
//                     {!isProduct && (scan.services ?? []).length > 0 && (
//                       <span className="text-xs text-slate-500 truncate hidden sm:inline">
//                         · {(scan.services as string[]).slice(0, 2).join(', ')}
//                       </span>
//                     )}
//                     {isProduct && scan.sources?.productUrl && (
//                       <span className="text-xs text-slate-500 truncate hidden sm:inline">
//                         · {scan.sources.productUrl}
//                       </span>
//                     )}
//                   </div>
//                   <span className="text-xs text-slate-500 flex-shrink-0">{formatDate(scan.createdAt)}</span>
//                 </div>
//               );
//             })}
//           </div>
//         </div>
//       )}
//     </div>
//   );
// }


'use client';
import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { discoveryApi } from '../../../lib/api';
import { Badge, ProgressBar, Spinner } from '../../../components/ui';
import {
  Plus, X, Zap, Loader2, CheckCircle2, Globe,
  Link2, FileText, AlignLeft, Package, Briefcase,
  ChevronDown, ChevronUp, Upload, ExternalLink,
  TrendingUp, Target, Users, Search,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { formatDate } from '../../../lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const WORK_TYPES = [
  { label: 'On-site', icon: '🏢' },
  { label: 'Remote',  icon: '🏠' },
  { label: 'Hybrid',  icon: '🔀' },
];

const DEFAULT_SOURCES = [
  'LinkedIn', 'Job Boards', 'Crunchbase',
  'Tech Stack (BuiltWith)', 'News & Press',
  'Reddit/Forums', 'GitHub', 'AngelList',
];

const SCAN_STEPS = [
  'Scanning LinkedIn job postings & company pages',
  'Checking Indeed, Glassdoor & job boards',
  'Finding decision-maker profiles',
  'Checking Crunchbase funding signals',
  'Scanning Reddit & developer communities',
  'Analyzing GitHub & tech signals',
  'Processing news & press releases',
  'Cross-referencing intent signals',
  'Deduplicating & scoring leads',
];

const ACTIVE_SCAN_KEY = 'lf_active_scan_id';

function cn(...cls: (string | boolean | undefined | null)[]) {
  return cls.filter(Boolean).join(' ');
}
function loadSources(): string[] {
  try { const s = localStorage.getItem('discovery_sources'); if (s) return JSON.parse(s); }
  catch {}
  return DEFAULT_SOURCES;
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
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-800/20 transition-colors text-left">
        <div>
          <p className="text-sm font-semibold text-slate-200">{title}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {open ? <ChevronUp size={14} className="text-slate-500 flex-shrink-0" />
              : <ChevronDown size={14} className="text-slate-500 flex-shrink-0" />}
      </button>
      {open && <div className="px-5 pb-5 border-t border-white/[0.04]">{children}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function LeadDiscoveryPage() {
  const qc = useQueryClient();

  // ── Mode ─────────────────────────────────────────────────────────────────
  const [scanMode, setScanMode] = useState<'service' | 'product'>('service');

  // ── Service mode ─────────────────────────────────────────────────────────
  const [newService, setNewService]         = useState('');
  const [workTypes,  setWorkTypes]          = useState<string[]>([]);
  const [sources,    setSources]            = useState<string[]>(DEFAULT_SOURCES);
  const [newSource,  setNewSource]          = useState('');
  const [targetIndustry, setTargetIndustry] = useState('');
  const [targetRegion,   setTargetRegion]   = useState('');

  // ── Product mode — ALL THREE inputs shown stacked (no tabs) ──────────────
  const [productUrl,          setProductUrl]          = useState('');
  const [productDescription,  setProductDescription]  = useState('');
  const [productDocumentText, setProductDocumentText] = useState('');
  const [productFileName,     setProductFileName]     = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Scan state ───────────────────────────────────────────────────────────
  const [activeScanId,        setActiveScanId]        = useState<string | null>(null);
  const [optimisticProgress,  setOptimisticProgress]  = useState(0);

  // ── Restore ───────────────────────────────────────────────────────────────
  useEffect(() => {
    setSources(loadSources());
    const stored = localStorage.getItem(ACTIVE_SCAN_KEY);
    if (stored) setActiveScanId(stored);
  }, []);
  useEffect(() => {
    if (activeScanId) localStorage.setItem(ACTIVE_SCAN_KEY, activeScanId);
    else              localStorage.removeItem(ACTIVE_SCAN_KEY);
  }, [activeScanId]);
  useEffect(() => {
    localStorage.setItem('discovery_sources', JSON.stringify(sources));
  }, [sources]);

  // ── Server-side active scan restore ──────────────────────────────────────
  const { data: serverActiveScan } = useQuery({
    queryKey: ['activeScan'],
    queryFn:  () => discoveryApi.getActiveScan().then(r => r.data.data),
    staleTime: 0, refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (!activeScanId && serverActiveScan?.id) setActiveScanId(serverActiveScan.id);
  }, [serverActiveScan, activeScanId]);

  // ── Data ──────────────────────────────────────────────────────────────────
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

  // ── Live poll ─────────────────────────────────────────────────────────────
  const { data: activeScan } = useQuery({
    queryKey: ['scan', activeScanId],
    queryFn:  () => activeScanId
      ? discoveryApi.getScanStatus(activeScanId).then(r => r.data.data)
      : null,
    enabled:        !!activeScanId,
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

  // ── Service management ────────────────────────────────────────────────────
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
  function addSource() {
    const t = newSource.trim();
    if (!t || sources.includes(t)) return;
    setSources(prev => [...prev, t]);
    setNewSource('');
  }
  function removeSource(i: number) { setSources(prev => prev.filter((_, j) => j !== i)); }

  // ── File upload ───────────────────────────────────────────────────────────
  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setProductFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => setProductDocumentText((ev.target?.result as string) || '');
    reader.readAsText(file);
    toast.success(`"${file.name}" loaded`);
  }

  // ── Progress ──────────────────────────────────────────────────────────────
  function startOptimisticProgress() {
    setOptimisticProgress(0);
    let v = 0;
    const iv = setInterval(() => { v += 2; setOptimisticProgress(v); if (v >= 10) clearInterval(iv); }, 600);
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  const scanMutation = useMutation({
    mutationFn: () => discoveryApi.startScan({ targetIndustry, targetRegion, workTypes, sources }),
    onSuccess: res => {
      const id = res.data.data.id ?? res.data.data.jobId;
      setActiveScanId(id);
      toast.success('Scan started — searching worldwide!');
      qc.invalidateQueries({ queryKey: ['scans'] });
      startOptimisticProgress();
    },
    onError: () => toast.error('Failed to start scan'),
  });

  const productScanMutation = useMutation({
    mutationFn: () => {
      // Pick whichever input was filled — priority: url > document > description
      let productType = 'description';
      if (productUrl.trim())            productType = 'url';
      else if (productDocumentText.trim()) productType = 'document';

      return discoveryApi.startProductScan({
        productType,
        productUrl:          productUrl.trim()          || undefined,
        productDescription:  productDescription.trim()  || undefined,
        productDocumentText: productDocumentText.trim() || undefined,
        targetIndustry, targetRegion, workTypes, sources,
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

  // ── Derived ───────────────────────────────────────────────────────────────
  const isMutating = scanMutation.isPending || productScanMutation.isPending;
  const scanning = isMutating || (
    !!activeScanId &&
    (activeScan == null || activeScan?.status === 'running' || activeScan?.status === 'pending')
  );
  const scanProgress = (activeScan?.progress != null && activeScan.progress > 0)
    ? activeScan.progress : optimisticProgress;
  const scanComplete = activeScan?.status === 'completed';

  const canLaunchService = services.length > 0;
  const canLaunchProduct = productUrl.trim().length > 0
    || productDescription.trim().length > 10
    || productDocumentText.trim().length > 10;
  const canLaunch = scanMode === 'service' ? canLaunchService : canLaunchProduct;

  function launchScan() {
    if (scanMode === 'service') scanMutation.mutate();
    else productScanMutation.mutate();
  }

  const totalLeadsEver = (scansData?.items ?? [])
    .reduce((s: number, j: any) => s + (j.leadsFound ?? 0), 0);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Lead Discovery Engine</h1>
          <p className="text-sm text-slate-500 mt-1">
            Finds companies that <span className="text-emerald-400 font-medium">need</span> your service — not competitors who provide it
          </p>
        </div>
        <div className="flex items-center gap-3">
          {totalLeadsEver > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-900 border border-white/[0.06] rounded-xl px-3 py-2">
              <TrendingUp size={12} className="text-emerald-400" />
              {totalLeadsEver.toLocaleString()} total discovered
            </div>
          )}
          <button className="btn-primary px-6 py-2.5 text-sm" onClick={launchScan}
            disabled={scanning || !canLaunch}>
            {scanning
              ? <><Loader2 size={14} className="animate-spin" /> Scanning…</>
              : <><Zap size={14} /> Launch AI Scan</>}
          </button>
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
                : 'bg-slate-950 border-white/[0.06] text-slate-400 hover:text-slate-200 hover:border-white/20'
            )}>
            {icon}{label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* ── Left column ────────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* ════ SERVICE MODE ════ */}
          {scanMode === 'service' && (<>

            <SectionCard title="Services / Positions"
              subtitle="Finds companies HIRING for this role or needing this service — these are your buyers, not your competitors">
              <div className="pt-4">
                {servicesLoading ? <Spinner /> : (
                  <div className="space-y-2 mb-3">
                    {services.map((s: any, i: number) => (
                      <div key={i} className="flex items-center justify-between bg-slate-950 rounded-xl px-3 py-2.5 group">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={13} className="text-emerald-400" />
                          <span className="text-sm text-slate-200">{s.name}</span>
                        </div>
                        <button onClick={() => removeService(i)}
                          className="text-slate-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                    {services.length === 0 && (
                      <p className="text-xs text-slate-600 text-center py-3">No services yet — add one to begin</p>
                    )}
                  </div>
                )}
                <div className="flex gap-2">
                  <input className="input text-sm" value={newService}
                    onChange={e => setNewService(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addService()}
                    placeholder='e.g. "NetSuite Consultant", "Salesforce Admin", "SAP Developer"' />
                  <button className="btn-primary flex-shrink-0 px-3" onClick={addService}><Plus size={14} /></button>
                </div>
                <p className="text-xs text-slate-600 mt-2">
                  💡 Specific = more leads. "NetSuite Consultant" beats just "ERP"
                </p>
              </div>
            </SectionCard>

            <SectionCard title="Work Profile" subtitle="Filter by work arrangement (optional)">
              <div className="pt-4 flex gap-2 flex-wrap">
                {WORK_TYPES.map(({ label, icon }) => {
                  const active = workTypes.includes(label);
                  return (
                    <button key={label} onClick={() => toggleWorkType(label)}
                      className={cn(
                        'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border transition-all',
                        active
                          ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                          : 'bg-slate-950 border-white/[0.06] text-slate-400 hover:text-slate-200 hover:border-white/20'
                      )}>
                      <span>{icon}</span>{label}
                      {active && <span className="ml-1 text-blue-400 text-xs">✓</span>}
                    </button>
                  );
                })}
                {workTypes.length === 0 && (
                  <p className="text-xs text-slate-600 mt-1 w-full">No filter — all arrangements (wider net)</p>
                )}
              </div>
            </SectionCard>

            <SectionCard title="Target Filters"
              subtitle="Leave blank for worldwide — recommended for maximum lead volume">
              <div className="pt-4 grid grid-cols-2 gap-3">
                <div>
                  <p className="label mb-1.5">Industry</p>
                  <input className="input text-sm" placeholder="e.g. SaaS, Fintech, Retail"
                    value={targetIndustry} onChange={e => setTargetIndustry(e.target.value)} />
                </div>
                <div>
                  <p className="label mb-1.5">Region</p>
                  <input className="input text-sm" placeholder="e.g. USA, India, Europe"
                    value={targetRegion} onChange={e => setTargetRegion(e.target.value)} />
                </div>
              </div>
            </SectionCard>
          </>)}

          {/* ════ PRODUCT MODE — stacked, no tabs ════ */}
          {scanMode === 'product' && (<>

            <SectionCard title="Product Information"
              subtitle="Fill any combination — AI uses all inputs together for better targeting">
              <div className="pt-5 space-y-6">

                {/* ── 1. URL ── */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/15 border border-blue-500/25 flex items-center justify-center flex-shrink-0">
                      <Link2 size={13} className="text-blue-400" />
                    </div>
                    <p className="text-sm font-semibold text-slate-200">Product URL</p>
                    <span className="text-[10px] bg-slate-800 border border-white/[0.06] text-slate-500 px-1.5 py-0.5 rounded font-medium tracking-wide">OPTIONAL</span>
                  </div>
                  <div className="flex gap-2">
                    <input className="input text-sm flex-1" placeholder="https://yourproduct.com"
                      value={productUrl} onChange={e => setProductUrl(e.target.value)} />
                    {productUrl && (
                      <a href={productUrl} target="_blank" rel="noreferrer"
                        className="btn-ghost flex-shrink-0 px-2.5"><ExternalLink size={13} /></a>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 mt-1.5">
                    AI fetches your landing page to understand what you offer
                  </p>
                </div>

                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-white/[0.06]" />
                  <span className="text-[10px] text-slate-600 font-semibold tracking-widest">AND / OR</span>
                  <div className="flex-1 h-px bg-white/[0.06]" />
                </div>

                {/* ── 2. Description ── */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/25 flex items-center justify-center flex-shrink-0">
                      <AlignLeft size={13} className="text-violet-400" />
                    </div>
                    <p className="text-sm font-semibold text-slate-200">Product Description</p>
                    <span className="text-[10px] bg-slate-800 border border-white/[0.06] text-slate-500 px-1.5 py-0.5 rounded font-medium tracking-wide">OPTIONAL</span>
                  </div>
                  <textarea className="input text-sm resize-none w-full" rows={5}
                    placeholder="Describe your product: what it does, who it's for, problems it solves, key features, use cases…"
                    value={productDescription}
                    onChange={e => setProductDescription(e.target.value)} />
                  <p className="text-xs text-slate-600 mt-1.5">
                    {productDescription.length}/3000 chars — more detail = better lead targeting
                  </p>
                </div>

                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-white/[0.06]" />
                  <span className="text-[10px] text-slate-600 font-semibold tracking-widest">AND / OR</span>
                  <div className="flex-1 h-px bg-white/[0.06]" />
                </div>

                {/* ── 3. Document upload ── */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center flex-shrink-0">
                      <FileText size={13} className="text-emerald-400" />
                    </div>
                    <p className="text-sm font-semibold text-slate-200">Upload Brochure / Spec Sheet</p>
                    <span className="text-[10px] bg-slate-800 border border-white/[0.06] text-slate-500 px-1.5 py-0.5 rounded font-medium tracking-wide">OPTIONAL</span>
                  </div>

                  <input ref={fileInputRef} type="file" accept=".txt,.md,.csv,.pdf"
                    onChange={handleFileUpload} className="hidden" />

                  {productDocumentText ? (
                    <div className="bg-slate-950 rounded-xl p-3 border border-emerald-500/20">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={13} className="text-emerald-400" />
                          <span className="text-xs text-emerald-400 font-medium">{productFileName}</span>
                        </div>
                        <button onClick={() => { setProductDocumentText(''); setProductFileName(''); }}
                          className="text-slate-600 hover:text-red-400 transition-colors">
                          <X size={12} />
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 line-clamp-2">
                        {productDocumentText.slice(0, 180)}…
                      </p>
                    </div>
                  ) : (
                    <button type="button" onClick={() => fileInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-white/[0.08] hover:border-emerald-500/30 rounded-xl p-5 text-center transition-colors group">
                      <Upload size={20} className="mx-auto mb-2 text-slate-600 group-hover:text-emerald-400 transition-colors" />
                      <p className="text-sm text-slate-400 group-hover:text-slate-300">
                        Click to upload .txt, .md, or .pdf
                      </p>
                      <p className="text-xs text-slate-600 mt-1">Max 5 MB</p>
                    </button>
                  )}
                  <p className="text-xs text-slate-600 mt-1.5">
                    Upload a one-pager, brochure, or spec sheet
                  </p>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Target Filters" subtitle="Leave blank for worldwide">
              <div className="pt-4 grid grid-cols-2 gap-3">
                <div>
                  <p className="label mb-1.5">Industry</p>
                  <input className="input text-sm" placeholder="e.g. SaaS, Retail"
                    value={targetIndustry} onChange={e => setTargetIndustry(e.target.value)} />
                </div>
                <div>
                  <p className="label mb-1.5">Region</p>
                  <input className="input text-sm" placeholder="e.g. USA, India"
                    value={targetRegion} onChange={e => setTargetRegion(e.target.value)} />
                </div>
              </div>
            </SectionCard>
          </>)}
        </div>

        {/* ── Right column ─────────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Scan control panel */}
          <div className="card p-6 flex flex-col min-h-[330px]">
            <h2 className="section-title mb-4">Discovery Control</h2>

            {scanning ? (
              <div className="flex-1 space-y-4">
                <div className="p-4 bg-blue-500/[0.06] border border-blue-500/20 rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                    <span className="text-sm font-semibold text-blue-300">
                      {activeScan?.sources?.scanType === 'product'
                        ? 'Analyzing product & finding buyers…'
                        : 'Scanning worldwide for leads…'}
                    </span>
                    <span className="ml-auto text-xs text-blue-400 font-mono">{scanProgress}%</span>
                  </div>
                  <ProgressBar value={scanProgress} color="blue" />
                  <p className="text-xs text-blue-400 mt-2">
                    {activeScan?.leadsFound ?? 0} leads found so far
                  </p>
                </div>

                <div className="space-y-2">
                  {SCAN_STEPS.map((step, i) => {
                    const threshold = (i + 1) / SCAN_STEPS.length * 100;
                    const done      = scanProgress >= threshold;
                    const active    = !done && scanProgress >= threshold - (100 / SCAN_STEPS.length);
                    return (
                      <div key={i} className={cn(
                        'flex items-center gap-2 text-xs transition-all',
                        done ? 'text-emerald-400' : active ? 'text-blue-400' : 'text-slate-600'
                      )}>
                        {done   ? <CheckCircle2 size={11} className="flex-shrink-0" />
                          : active ? <Loader2 size={11} className="animate-spin flex-shrink-0" />
                          : <span className="w-3 text-center flex-shrink-0">○</span>}
                        {step}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-600 text-center pt-1">
                  Progress saved — safe to navigate away and return
                </p>
              </div>

            ) : scanComplete ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <CheckCircle2 size={30} className="text-emerald-400" />
                </div>
                <div>
                  <p className="font-semibold text-slate-200 mb-1">Scan Complete!</p>
                  <p className="text-3xl font-bold text-emerald-400">{activeScan.leadsFound}</p>
                  <p className="text-sm text-slate-500 mt-1">new leads discovered</p>
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-white/[0.06] text-left w-full">
                  <p className="text-xs text-slate-400 font-semibold mb-1">Next step →</p>
                  <p className="text-xs text-slate-500">
                    Open any lead in the CRM and click{' '}
                    <span className="text-emerald-400 font-medium">Find via SignalHire</span> or{' '}
                    <span className="text-violet-400 font-medium">Search Apollo</span>{' '}
                    to get contact details on demand.
                  </p>
                </div>
                <a href="/dashboard/leads" className="btn-primary text-sm px-6 py-2.5 w-full justify-center">
                  <Users size={14} /> View All Leads →
                </a>
              </div>

            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600/20 to-cyan-500/10 border border-blue-500/25 flex items-center justify-center">
                  {scanMode === 'product'
                    ? <Package size={28} className="text-blue-400" />
                    : <Target  size={28} className="text-blue-400" />}
                </div>
                <div>
                  <p className="font-semibold text-slate-200 mb-1">
                    {scanMode === 'product' ? 'Ready for Product Scan' : 'Ready to Discover Leads'}
                  </p>
                  <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                    {scanMode === 'product'
                      ? 'AI analyzes your inputs and finds companies actively searching for similar solutions'
                      : `Google Jobs engine + buyer-intent queries — finds companies HIRING for your service (= your buyers). Phase 1: Google Jobs paginated (400+ structured employer leads). Phase 2: "looking for X", "need a X" queries. Target: 500–1000 leads.`}
                  </p>
                </div>
                <button className="btn-primary px-8 py-3 text-sm w-full justify-center"
                  onClick={launchScan} disabled={isMutating || !canLaunch}>
                  {isMutating ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
                  Launch AI Scan
                </button>
                {!canLaunch && (
                  <p className="text-xs text-amber-400">
                    {scanMode === 'service'
                      ? '↑ Add at least one service or position first'
                      : '↑ Add a URL, description, or upload a document first'}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* How it works */}
          <div className="card p-4">
            <h3 className="label mb-3">How it works</h3>
            <div className="space-y-2.5">
              {[
                {
                  n: '1', color: 'blue',
                  title: 'Phase 1 — Google Jobs engine (buyer-intent)',
                  desc:  'Uses Google Jobs API to find EMPLOYERS actively posting the role. Every result = a company that NEEDS your service, not a competitor. Paginated 5× per variant for 400+ structured leads.',
                },
                {
                  n: '2', color: 'violet',
                  title: 'Phase 2 — Need-signal queries',
                  desc:  '"Looking for NetSuite consultant", "migration project", "need a Salesforce admin" — queries targeting companies expressing a NEED. Funding signals included (Series A/B = they have budget).',
                },
                {
                  n: '3', color: 'emerald',
                  title: 'Phase 3 — Contact enrichment (on demand)',
                  desc:  'Open any lead → click "Find via SignalHire" or "Search Apollo" to get emails & phone. You control which leads to enrich — saves API credits.',
                },
              ].map(({ n, color, title, desc }) => (
                <div key={n} className={`flex items-start gap-3 p-3 bg-slate-950 rounded-xl border border-${color}-500/10`}>
                  <span className={`w-6 h-6 rounded-full bg-${color}-500/20 text-${color}-400 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5`}>
                    {n}
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-slate-300 mb-0.5">{title}</p>
                    <p className="text-[11px] text-slate-500 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Active filters */}
          {(workTypes.length > 0 || targetIndustry || targetRegion) && (
            <div className="card p-4">
              <h3 className="label mb-3">Active Filters</h3>
              <div className="flex flex-wrap gap-2">
                {workTypes.map(wt => (
                  <span key={wt} className="bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg px-2.5 py-1 text-xs font-medium">{wt}</span>
                ))}
                {targetIndustry && <span className="bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-lg px-2.5 py-1 text-xs font-medium">{targetIndustry}</span>}
                {targetRegion   && <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-lg px-2.5 py-1 text-xs font-medium">{targetRegion}</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Data Sources ─────────────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="section-title">Data Sources</h2>
          <span className="text-xs text-slate-500">{sources.length} active</span>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Each source is searched with multiple query patterns per scan for maximum coverage.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-4">
          {sources.map((s, i) => (
            <div key={i} className="group bg-slate-950 rounded-xl p-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                <span className="text-xs text-slate-300 truncate">{s}</span>
              </div>
              <button onClick={() => removeSource(i)}
                className="text-slate-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input className="input text-sm" value={newSource}
            onChange={e => setNewSource(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addSource()}
            placeholder="Add custom source (e.g. ProductHunt, G2, Capterra)" />
          <button className="btn-ghost flex-shrink-0 px-3" onClick={addSource}><Plus size={14} /></button>
        </div>
      </div>

      {/* ── Scan History ─────────────────────────────────────────────────────── */}
      {(scansData?.items?.length ?? 0) > 0 && (
        <div className="card p-5">
          <h2 className="section-title mb-4">Scan History</h2>
          <div className="space-y-2">
            {(scansData!.items as any[]).slice(0, 8).map((scan: any) => {
              const isProduct = scan.sources?.scanType === 'product';
              const wt = scan.sources?.workTypes as string[] | undefined;
              return (
                <div key={scan.id} className="flex items-center justify-between p-3 bg-slate-950 rounded-xl gap-3">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <Badge color={
                      scan.status === 'completed' ? 'green' :
                      scan.status === 'running'   ? 'blue'  :
                      scan.status === 'failed'    ? 'red'   : 'gray'
                    }>{scan.status}</Badge>
                    <span className={cn(
                      'text-xs rounded px-1.5 py-0.5 border',
                      isProduct
                        ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                        : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                    )}>
                      {isProduct ? 'product' : 'service'}
                    </span>
                    <span className="text-sm font-semibold text-slate-200">
                      {scan.leadsFound ?? 0} leads
                    </span>
                    {wt && wt.length > 0 && (
                      <span className="text-xs text-slate-500 truncate">· {wt.join(', ')}</span>
                    )}
                    {scan.targetRegion && (
                      <span className="text-xs text-slate-500">· {scan.targetRegion}</span>
                    )}
                    {!isProduct && (scan.services ?? []).length > 0 && (
                      <span className="text-xs text-slate-500 truncate hidden sm:inline">
                        · {(scan.services as string[]).slice(0, 2).join(', ')}
                      </span>
                    )}
                    {isProduct && scan.sources?.productUrl && (
                      <span className="text-xs text-slate-500 truncate hidden sm:inline">
                        · {scan.sources.productUrl}
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
