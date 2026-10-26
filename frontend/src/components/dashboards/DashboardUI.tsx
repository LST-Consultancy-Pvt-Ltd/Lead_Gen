'use client';

// Presentational building blocks shared by the Admin / Manager / Executive
// dashboards. No data fetching or business logic lives here.

import { cn } from '../../lib/utils';
import { ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { useAuthStore } from '../../store/authStore';
import type { LucideIcon } from 'lucide-react';
import { Select } from '../ui/Select';
import { MultiSelect, type MultiSelectProps } from '../ui/MultiSelect';

// ── Tones ───────────────────────────────────────────────────────────────────
export type Tone = 'blue' | 'indigo' | 'violet' | 'emerald' | 'amber' | 'rose' | 'cyan';

// Full class strings per tone (kept literal so Tailwind can see them)
const TONES: Record<Tone, {
  solid: string; soft: string; text: string; tint: string; orb: string; bar: string; ring: string;
}> = {
  blue: {
    solid: 'bg-gradient-to-br from-blue-500 to-blue-700 shadow-blue-500/40',
    soft: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    text: 'text-blue-600 dark:text-blue-400',
    tint: 'from-blue-50 via-white to-white dark:from-blue-500/[0.14] dark:via-surface dark:to-surface',
    orb: 'bg-blue-500',
    bar: 'from-blue-500 to-cyan-400',
    ring: 'hover:border-blue-300 dark:hover:border-blue-500/40',
  },
  indigo: {
    solid: 'bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-indigo-500/40',
    soft: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    text: 'text-indigo-600 dark:text-indigo-400',
    tint: 'from-indigo-50 via-white to-white dark:from-indigo-500/[0.14] dark:via-surface dark:to-surface',
    orb: 'bg-indigo-500',
    bar: 'from-indigo-500 to-blue-400',
    ring: 'hover:border-indigo-300 dark:hover:border-indigo-500/40',
  },
  violet: {
    solid: 'bg-gradient-to-br from-violet-500 to-purple-700 shadow-violet-500/40',
    soft: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    text: 'text-violet-600 dark:text-violet-400',
    tint: 'from-violet-50 via-white to-white dark:from-violet-500/[0.14] dark:via-surface dark:to-surface',
    orb: 'bg-violet-500',
    bar: 'from-violet-500 to-fuchsia-400',
    ring: 'hover:border-violet-300 dark:hover:border-violet-500/40',
  },
  emerald: {
    solid: 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/40',
    soft: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    text: 'text-emerald-600 dark:text-emerald-400',
    tint: 'from-emerald-50 via-white to-white dark:from-emerald-500/[0.14] dark:via-surface dark:to-surface',
    orb: 'bg-emerald-500',
    bar: 'from-emerald-500 to-teal-400',
    ring: 'hover:border-emerald-300 dark:hover:border-emerald-500/40',
  },
  amber: {
    solid: 'bg-gradient-to-br from-amber-400 to-orange-600 shadow-amber-500/40',
    soft: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    text: 'text-amber-600 dark:text-amber-400',
    tint: 'from-amber-50 via-white to-white dark:from-amber-500/[0.14] dark:via-surface dark:to-surface',
    orb: 'bg-amber-500',
    bar: 'from-amber-500 to-yellow-400',
    ring: 'hover:border-amber-300 dark:hover:border-amber-500/40',
  },
  rose: {
    solid: 'bg-gradient-to-br from-rose-500 to-pink-700 shadow-rose-500/40',
    soft: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    text: 'text-rose-600 dark:text-rose-400',
    tint: 'from-rose-50 via-white to-white dark:from-rose-500/[0.14] dark:via-surface dark:to-surface',
    orb: 'bg-rose-500',
    bar: 'from-rose-500 to-pink-400',
    ring: 'hover:border-rose-300 dark:hover:border-rose-500/40',
  },
  cyan: {
    solid: 'bg-gradient-to-br from-cyan-500 to-sky-700 shadow-cyan-500/40',
    soft: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
    text: 'text-cyan-600 dark:text-cyan-400',
    tint: 'from-cyan-50 via-white to-white dark:from-cyan-500/[0.14] dark:via-surface dark:to-surface',
    orb: 'bg-cyan-500',
    bar: 'from-cyan-500 to-sky-400',
    ring: 'hover:border-cyan-300 dark:hover:border-cyan-500/40',
  },
};

// ── Filter select ───────────────────────────────────────────────────────────
export const filterSelectCls =
  'select-styled appearance-none h-10 pr-9 rounded-xl text-[13px] font-medium cursor-pointer outline-none transition-all duration-150 ' +
  'bg-white dark:bg-surface text-ink ' +
  'border border-line shadow-sm dark:shadow-none ' +
  'hover:border-blue-400 dark:hover:border-blue-500/50 hover:shadow-md hover:shadow-blue-500/10 ' +
  'focus-visible:border-blue-500 focus-visible:ring-4 focus-visible:ring-blue-500/15 ' +
  'disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:shadow-sm dark:disabled:hover:border-line ' +
  '[&>option]:bg-white [&>option]:text-ink dark:[&>option]:bg-surface dark:[&>option]:text-ink';

export function FilterSelect({
  icon: Icon, tone = 'blue', className, children, ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { icon?: LucideIcon; tone?: Tone }) {
  return (
    <div className={cn('relative group inline-flex', props.disabled && 'opacity-50')}>
      {Icon && (
        <span className={cn('pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center', TONES[tone].soft)}>
          <Icon size={14} />
        </span>
      )}
      <Select {...props} hideChevron className={cn(filterSelectCls, Icon ? 'pl-10' : 'pl-3.5', className)}>
        {children}
      </Select>
      <ChevronDown
        size={15}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-hover:text-blue-500"
      />
    </div>
  );
}

// ── Multi-select filter ────────────────────────────────────────────────────
export function MultiFilterSelect({
  icon: Icon, tone = 'blue', className, ...props
}: Omit<MultiSelectProps, 'triggerClassName'> & { icon?: LucideIcon; tone?: Tone; className?: string }) {
  return (
    <div className={cn('relative group inline-flex', props.disabled && 'opacity-50')}>
      {Icon && (
        <span className={cn('pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center z-[1]', TONES[tone].soft)}>
          <Icon size={14} />
        </span>
      )}
      <MultiSelect {...props} triggerClassName={cn(filterSelectCls, Icon ? 'pl-10' : 'pl-3.5', className)} />
      <ChevronDown
        size={15}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-hover:text-blue-500"
      />
    </div>
  );
}

// ── Page header (hero banner) ───────────────────────────────────────────────
export function DashboardHeader({
  title, subtitle, children,
}: { title: string; subtitle?: React.ReactNode; children?: React.ReactNode }) {
  const user = useAuthStore((st) => st.user);
  const rawFirst = (user?.name || '').trim().split(/\s+/)[0] || '';
  // Display only: capitalise the first letter (e.g. "sachin" → "Sachin")
  const firstName = rawFirst ? rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1) : '';
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 p-6 sm:p-7 shadow-xl shadow-indigo-500/20">
      {/* decoration */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.15] [background-image:radial-gradient(rgba(255,255,255,0.9)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(to_left,black,transparent_70%)]" />
      <div className="pointer-events-none absolute -right-16 -top-24 w-72 h-72 rounded-full bg-cyan-400/30 blur-3xl" />
      <div className="pointer-events-none absolute -left-10 -bottom-24 w-64 h-64 rounded-full bg-fuchsia-500/25 blur-3xl" />

      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-blue-100">
            <span>{format(new Date(), 'EEEE, d MMMM yyyy')}</span>
          </div>
          <h1 className="mt-2 font-display text-2xl sm:text-[28px] font-semibold tracking-[-0.025em] text-white">
            {firstName ? `Welcome back, ${firstName}` : title}
          </h1>
          <p className="mt-1 text-[13px] text-blue-100/90">
            {firstName ? title : null}
            {firstName && subtitle ? ' · ' : null}
            {subtitle}
          </p>
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}

// ── KPI card ────────────────────────────────────────────────────────────────
export function KpiCard({
  icon: Icon, tone = 'blue', label, value, children,
}: { icon: LucideIcon; tone?: Tone; label: string; value: React.ReactNode; children?: React.ReactNode }) {
  const t = TONES[tone];
  return (
    <div className={cn('card relative overflow-hidden p-5 min-h-[132px] flex flex-col transition-all duration-200 hover:-translate-y-px hover:shadow-lg', t.ring)}>
      {/* colour wash + glow */}
      <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br', t.tint)} />
      <div className={cn('pointer-events-none absolute -right-10 -top-10 w-32 h-32 rounded-full blur-3xl opacity-20 dark:opacity-25', t.orb)} />
      <div className={cn('pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r', t.bar)} />

      <div className="relative flex items-start justify-between">
        <p className="text-[13px] font-medium text-ink-2">{label}</p>
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg', t.solid)}>
          <Icon size={20} strokeWidth={2} />
        </div>
      </div>
      <p className="relative mt-2 font-display text-[28px] leading-none font-semibold tracking-[-0.04em] text-ink">
        {value}
      </p>
      {children && <div className="relative mt-auto pt-3 text-xs text-ink-3">{children}</div>}
    </div>
  );
}

// ── Section card ────────────────────────────────────────────────────────────
export function SectionCard({
  title, subtitle, action, icon: Icon, tone = 'blue', className, children,
}: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode; icon?: LucideIcon; tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn('card relative overflow-hidden p-5 flex flex-col min-w-0', className)}>
      <div className={cn('pointer-events-none absolute -right-16 -top-16 w-40 h-40 rounded-full blur-3xl opacity-[0.08] dark:opacity-[0.12]', TONES[tone].orb)} />
      <div className="relative flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <div className={cn('w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0', TONES[tone].soft)}>
              <Icon size={18} />
            </div>
          )}
          <div className="min-w-0">
            <h2 className="section-title">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="relative flex flex-col flex-1 min-w-0">{children}</div>
    </section>
  );
}

// ── Count pill (section header) ─────────────────────────────────────────────
export function CountPill({ children, tone = 'rose' }: { children: React.ReactNode; tone?: 'rose' | 'blue' }) {
  return (
    <span className={cn(
      'inline-flex items-center h-6 min-w-[24px] justify-center px-2 rounded-md text-xs font-semibold tabular-nums',
      tone === 'rose' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    )}>
      {children}
    </span>
  );
}

// ── Horizontal bar row ──────────────────────────────────────────────────────
export function BarRow({
  label, count, pct, tone, barColor,
}: { label: string; count: React.ReactNode; pct: number; tone?: Tone; barColor?: string }) {
  const grad = tone ? TONES[tone].bar : '';
  const style = barColor ? { backgroundImage: `linear-gradient(90deg, ${barColor}, ${barColor}99)` } : undefined;
  return (
    <div>
      <div className="flex items-center justify-between text-[13px] mb-2">
        <span className="flex items-center gap-2 font-medium text-ink-2">
          <span className={cn('w-2.5 h-2.5 rounded-full bg-gradient-to-r', grad)} style={style} />
          {label}
        </span>
        <span className="font-semibold tabular-nums text-ink">{count}</span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden bg-line dark:bg-[rgba(148,163,184,0.12)]">
        <div
          className={cn('h-full rounded-full bg-gradient-to-r animate-bar-grow transition-[width] duration-500 ease-out shadow-sm', grad)}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%`, ...style }}
        />
      </div>
    </div>
  );
}

// ── Person avatar (initials) ────────────────────────────────────────────────
const AVATAR_TONES = [
  'from-blue-500 to-indigo-600',
  'from-indigo-500 to-violet-600',
  'from-violet-500 to-fuchsia-600',
  'from-emerald-500 to-teal-600',
  'from-amber-400 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-cyan-500 to-sky-600',
];

export function PersonAvatar({ name }: { name: string }) {
  const initials = (name || 'U').split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const hash = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <div className={cn('w-9 h-9 rounded-lg bg-gradient-to-br flex items-center justify-center text-xs font-semibold text-white flex-shrink-0 shadow-sm', AVATAR_TONES[hash % AVATAR_TONES.length])}>
      {initials}
    </div>
  );
}

// ── Chart helpers ───────────────────────────────────────────────────────────
// Prefer useChartTheme() (src/hooks/useChartTheme.ts) — these follow the theme via CSS where possible.
export const chartTick = { fontSize: 11 };
export const chartGridStroke = 'rgb(var(--line))';
export const chartCursor = { fill: 'rgb(var(--ink-3) / 0.12)' };

export function ChartTooltip({ active, payload, label, suffix = '' }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 shadow-lg shadow-slate-900/10 dark:shadow-black/40">
      <p className="text-[11px] font-medium text-ink-3">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-ink">
        {payload[0].value}{suffix}
      </p>
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────
export function EmptyBlock({ icon: Icon, message, className }: { icon: LucideIcon; message: string; className?: string }) {
  return (
    <div className={cn('flex flex-1 flex-col items-center justify-center gap-2.5 py-8 text-center', className)}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-slate-100 dark:bg-slate-400/[0.08] text-slate-400 dark:text-slate-500">
        <Icon size={18} />
      </div>
      <p className="text-[13px] text-ink-3">{message}</p>
    </div>
  );
}

// ── Loading skeleton ────────────────────────────────────────────────────────
function Bone({ className }: { className?: string }) {
  return <div className={cn('rounded-md bg-slate-200/80 dark:bg-slate-400/[0.10]', className)} />;
}

export function DashboardSkeleton({ kpis = 4 }: { kpis?: number }) {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading dashboard">
      <div className="space-y-2">
        <Bone className="h-7 w-48" />
        <Bone className="h-4 w-32" />
      </div>
      <div className={cn('grid grid-cols-1 sm:grid-cols-2 gap-4', kpis === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4')}>
        {Array.from({ length: kpis }).map((_, i) => (
          <div key={i} className="card p-5 min-h-[132px]">
            <Bone className="w-9 h-9 rounded-[10px]" />
            <Bone className="mt-4 h-3.5 w-24" />
            <Bone className="mt-2.5 h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5 space-y-5">
          <Bone className="h-4 w-40" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Bone className="h-3 w-full" />
              <Bone className="h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
        <div className="card p-5">
          <Bone className="h-4 w-32" />
          <div className="mt-6 flex items-end gap-3 h-36">
            {[40, 70, 55, 85, 60, 75].map((h, i) => (
              <div key={i} className="flex-1 rounded-t-md bg-slate-200/80 dark:bg-slate-400/[0.10]" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1].map((c) => (
          <div key={c} className="card p-5 space-y-4">
            <Bone className="h-4 w-36" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Bone className="w-9 h-9 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Bone className="h-3 w-1/2" />
                  <Bone className="h-2.5 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
