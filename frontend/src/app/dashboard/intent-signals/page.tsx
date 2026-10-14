'use client';
import { useQuery } from '@tanstack/react-query';
import { discoveryApi } from '../../../lib/api';
import { Badge, Spinner } from '../../../components/ui';
import { timeAgo } from '../../../lib/utils';
import { Zap, Radar, Briefcase, Banknote, Cpu, MessagesSquare, Clock, Gauge } from 'lucide-react';
import { PageHero } from '../../../components/ui/PageHero';
import { KpiCard } from '../../../components/dashboards/DashboardUI';
import Link from 'next/link';

const signalColors: Record<string,string> = { hiring:'blue', funding:'green', tech:'purple', social:'amber', content:'blue', developer:'red' };
const borderColors: Record<string,string> = { hiring:'rgb(var(--c-primary-500))', funding:'#10b981', tech:'rgb(var(--c-tertiary-500))', social:'#f59e0b', content:'#06b6d4', developer:'#ef4444' };

export default function IntentSignalsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['intent-signals'],
    queryFn: () => discoveryApi.getSignals({ limit: 50 }).then(r => ({ items: Array.isArray(r.data.data) ? r.data.data : r.data.data?.items ?? [] })),
    refetchInterval: 30000,
  });

  const signals: any[] = data?.items ?? [];

  const stats = [
    { label: 'Hiring Signals', count: signals.filter((s: any) => s.signalType === 'hiring').length, color: 'blue' },
    { label: 'Funding Events', count: signals.filter((s: any) => s.signalType === 'funding').length, color: 'green' },
    { label: 'Tech Discussions', count: signals.filter((s: any) => s.signalType === 'tech').length, color: 'purple' },
    { label: 'Forum Posts', count: signals.filter((s: any) => s.signalType === 'social').length, color: 'amber' },
  ];

  return (
    <div className="space-y-6">
      <PageHero
        icon={Radar}
        eyebrow="AI Discovery"
        title="Intent Signals"
        subtitle="Real-time buying intent detected across the internet"
        tone="emerald"
      />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map(s => (
          <KpiCard
            key={s.label}
            icon={s.color==='blue' ? Briefcase : s.color==='green' ? Banknote : s.color==='purple' ? Cpu : MessagesSquare}
            tone={s.color==='blue' ? 'blue' : s.color==='green' ? 'emerald' : s.color==='purple' ? 'violet' : 'amber'}
            label={s.label}
            value={isLoading?'—':s.count}
          />
        ))}
      </div>

      {/* Signals Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40"><Spinner size={24}/></div>
      ) : signals.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center bg-slate-100 dark:bg-slate-400/[0.08] text-slate-400 dark:text-slate-500">
            <Zap size={22}/>
          </div>
          <p className="font-semibold text-ink">No signals yet</p>
          <p className="text-sm text-ink-3 mt-1">
            <Link href="/dashboard/lead-discovery" className="font-medium text-blue-600 dark:text-blue-400 hover:underline">Run an AI scan</Link> to detect intent signals
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {signals.map((s: any, i: number) => (
            <div key={i} className="card relative overflow-hidden p-4 pl-5 cursor-pointer transition-all duration-200 hover:-translate-y-px hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-500/40">
              <div className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: borderColors[s.signalType]??'rgb(var(--ink-3))' }} />
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {s.companyName?.charAt(0).toUpperCase() ?? '?'}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{s.companyName}</p>
                    <p className="text-[11px] text-ink-3 inline-flex items-center gap-1"><Clock size={10}/> {timeAgo(s.createdAt)}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <Badge color={signalColors[s.signalType]??'gray'} className="capitalize">{s.signalType}</Badge>
                  <span className={`inline-flex items-center gap-1 text-xs font-bold tabular-nums ${s.confidence>=80?'text-emerald-600 dark:text-emerald-400':'text-amber-600 dark:text-amber-400'}`}>
                    <Gauge size={11}/> {s.confidence}%
                  </span>
                </div>
              </div>
              <p className="text-xs text-ink-2 leading-relaxed line-clamp-2">{s.signalText}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
