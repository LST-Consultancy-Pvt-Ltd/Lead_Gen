'use client';
import { cn } from '../../lib/utils';
import { Loader2 } from 'lucide-react';

// ── Badge ──────────────────────────────────────────────────────────────────
const badgeVariants: Record<string, string> = {
  blue:   'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-400/20',
  green:  'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-400/20',
  amber:  'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-400/20',
  red:    'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-400/20',
  purple: 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-400/20',
  gray:   'bg-slate-100 dark:bg-white/[0.05] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10',
};
export function Badge({ children, color = 'blue', className }: { children: React.ReactNode; color?: string; className?: string }) {
  return <span className={cn('badge', badgeVariants[color] ?? badgeVariants.gray, className)}>{children}</span>;
}

// ── Avatar ─────────────────────────────────────────────────────────────────
const gradients = ['from-blue-500 to-cyan-500','from-violet-500 to-purple-500','from-emerald-500 to-teal-500','from-amber-500 to-orange-500','from-rose-500 to-pink-500'];
export function Avatar({ initials, size = 'sm', className }: { initials: string; size?: 'xs'|'sm'|'md'|'lg'; className?: string }) {
  const sz = { xs:'w-6 h-6 text-[10px]', sm:'w-8 h-8 text-xs', md:'w-10 h-10 text-sm', lg:'w-12 h-12 text-base' }[size];
  const hash = initials.split('').reduce((a,c) => a + c.charCodeAt(0), 0);
  const grad = gradients[hash % gradients.length];
  return <div className={cn(sz,'rounded-full bg-gradient-to-br flex items-center justify-center font-semibold text-white flex-shrink-0 ring-2 ring-surface shadow-sm', grad, className)}>{initials.slice(0,2).toUpperCase()}</div>;
}

// ── ScoreRing ──────────────────────────────────────────────────────────────
export function ScoreRing({ score, size = 40 }: { score: number; size?: number }) {
  const r = size/2 - 4;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score/100)*circ;
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#64748b';
  return (
    <svg width={size} height={size} style={{ transform:'rotate(-90deg)' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="3"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="3"
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition:'stroke-dashoffset 0.8s ease' }}/>
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="middle"
        fill={color} fontSize="10" fontWeight="700" style={{ transform:`rotate(90deg)`, transformOrigin:`${size/2}px ${size/2}px` }}>
        {score}
      </text>
    </svg>
  );
}

// ── ProgressBar ────────────────────────────────────────────────────────────
export function ProgressBar({ value, max = 100, color = 'blue' }: { value: number; max?: number; color?: string }) {
  const colors: Record<string,string> = { blue:'from-blue-500 to-cyan-400', green:'from-emerald-500 to-teal-400', amber:'from-amber-500 to-orange-400' };
  const pct = Math.min(100, Math.round((value/max)*100));
  return (
    <div className="h-2 bg-slate-100 dark:bg-white/[0.06] rounded-full overflow-hidden">
      <div className={cn('h-full bg-gradient-to-r rounded-full transition-all duration-700', colors[color] ?? colors.blue)} style={{ width:`${pct}%` }}/>
    </div>
  );
}

// ── Spinner ────────────────────────────────────────────────────────────────
export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-slate-400"/>;
}

// ── Stat Card ──────────────────────────────────────────────────────────────
export function StatCard({ label, value, delta, icon: Icon, positive = true }: any) {
  return (
    <div className="card card-hover relative overflow-hidden p-5">
      <div className="pointer-events-none absolute -right-8 -top-8 w-28 h-28 rounded-full bg-gradient-to-br from-blue-500/10 to-indigo-500/0 blur-2xl"/>
      <div className="relative flex items-center justify-between mb-4">
        <span className="label">{label}</span>
        {Icon && <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/15 to-indigo-500/10 ring-1 ring-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-300"><Icon size={16}/></div>}
      </div>
      <div className="relative font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white mb-1">{value}</div>
      {delta && <div className={cn('relative inline-flex items-center text-xs font-semibold px-1.5 py-0.5 rounded-md', positive ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' : 'text-rose-600 dark:text-rose-400 bg-rose-500/10')}>{delta}</div>}
    </div>
  );
}

// ── Empty State ────────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, description, action }: any) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="relative mb-5">
        <div className="absolute inset-0 rounded-2xl bg-blue-500/20 blur-xl"/>
        <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-500/15 dark:to-indigo-500/10 ring-1 ring-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-300">
          <Icon size={26}/>
        </div>
      </div>
      <h3 className="font-display font-semibold text-slate-800 dark:text-slate-100 mb-1.5">{title}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 max-w-xs leading-relaxed">{description}</p>
      {action}
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────
export function Modal({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative bg-white dark:bg-surface border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden animate-fade-in">
        <div className="h-1 w-full bg-gradient-to-r from-blue-600 via-indigo-500 to-cyan-400"/>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/[0.07]">
          <h2 className="font-display text-lg font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h2>
          <button onClick={onClose} title="Close" className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/[0.06] transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-5rem)]">
          {children}
        </div>
      </div>
    </div>
  );
}

// ── SearchableDropdown ─────────────────────────────────────────────────────
export { SearchableDropdown } from './SearchableDropdown';

// ── Pagination ─────────────────────────────────────────────────────────────
export { Pagination } from './Pagination';

// ── Select ─────────────────────────────────────────────────────────────────
export { Select } from './Select';
