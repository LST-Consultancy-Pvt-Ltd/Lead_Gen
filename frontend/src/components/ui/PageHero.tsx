'use client';

// Gradient hero banner used at the top of main pages. Presentational only.

import { cn } from '../../lib/utils';
import type { LucideIcon } from 'lucide-react';

const HERO_GRADIENTS = {
  blue: 'from-blue-600 via-indigo-600 to-violet-600 shadow-indigo-500/20',
  violet: 'from-violet-600 via-purple-600 to-fuchsia-600 shadow-violet-500/20',
  emerald: 'from-emerald-600 via-teal-600 to-cyan-600 shadow-teal-500/20',
} as const;

export function PageHero({
  icon: Icon, eyebrow, title, subtitle, tone = 'blue', children,
}: {
  icon?: LucideIcon;
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  tone?: keyof typeof HERO_GRADIENTS;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('relative overflow-hidden rounded-2xl bg-gradient-to-br p-6 sm:p-7 shadow-xl', HERO_GRADIENTS[tone])}>
      {/* decoration */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.15] [background-image:radial-gradient(rgba(255,255,255,0.9)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(to_left,black,transparent_70%)]" />
      <div className="pointer-events-none absolute -right-16 -top-24 w-72 h-72 rounded-full bg-cyan-400/30 blur-3xl" />
      <div className="pointer-events-none absolute -left-10 -bottom-24 w-64 h-64 rounded-full bg-fuchsia-500/25 blur-3xl" />

      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-4 min-w-0">
          {Icon && (
            <div className="hidden sm:flex w-12 h-12 rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur items-center justify-center flex-shrink-0 text-white shadow-lg">
              <Icon size={24} />
            </div>
          )}
          <div className="min-w-0">
            {eyebrow && (
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-100/90">{eyebrow}</p>
            )}
            <h1 className="mt-1 font-display text-2xl sm:text-[28px] font-semibold tracking-[-0.025em] text-white">{title}</h1>
            {subtitle && <p className="mt-1 text-[13px] text-blue-100/90">{subtitle}</p>}
          </div>
        </div>
        {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
      </div>
    </div>
  );
}
