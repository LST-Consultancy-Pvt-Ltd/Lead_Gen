'use client';
import { cn } from '../../lib/utils';
import { Loader2 } from 'lucide-react';

// ── Badge ──────────────────────────────────────────────────────────────────
const badgeVariants: Record<string, string> = {
  blue:   'bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30',
  green:  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30',
  amber:  'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30',
  red:    'bg-red-500/15 text-red-600 dark:text-red-300 border-red-500/30',
  purple: 'bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/30',
  gray:   'bg-slate-200/60 dark:bg-slate-700/40 text-slate-600 dark:text-slate-400 border-slate-300/60 dark:border-slate-600/40',
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
  return <div className={cn(sz,'rounded-xl bg-gradient-to-br flex items-center justify-center font-bold text-white flex-shrink-0', grad, className)}>{initials.slice(0,2).toUpperCase()}</div>;
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
    <div className="h-1.5 bg-slate-200 dark:bg-slate-700/60 rounded-full overflow-hidden">
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
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="label">{label}</span>
        {Icon && <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400"><Icon size={15}/></div>}
      </div>
      <div className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100 mb-1">{value}</div>
      {delta && <div className={cn('text-xs font-medium', positive ? 'text-emerald-400' : 'text-red-400')}>{delta}</div>}
    </div>
  );
}

// ── Empty State ────────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, description, action }: any) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center mb-4 text-slate-500">
        <Icon size={24}/>
      </div>
      <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-1">{title}</h3>
      <p className="text-sm text-slate-500 mb-4 max-w-xs">{description}</p>
      {action}
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────
export function Modal({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/10">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          <button onClick={onClose} title="Close" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
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
