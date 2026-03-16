'use client';
import { useQuery } from '@tanstack/react-query';
import { discoveryApi } from '../../../lib/api';
import { Badge, Spinner } from '../../../components/ui';
import { timeAgo } from '../../../lib/utils';
import { Zap } from 'lucide-react';
import Link from 'next/link';

const signalColors: Record<string,string> = { hiring:'blue', funding:'green', tech:'purple', social:'amber', content:'blue', developer:'red' };
const borderColors: Record<string,string> = { hiring:'#3b82f6', funding:'#10b981', tech:'#8b5cf6', social:'#f59e0b', content:'#06b6d4', developer:'#ef4444' };

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
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Intent Signals</h1>
          <p className="text-sm text-slate-500 mt-1">Real-time buying intent detected across the internet</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-dot"/>
          <span className="text-xs font-semibold text-emerald-400">Live</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map(s => (
          <div key={s.label} className="card p-4 border-l-2"
            style={{ borderLeftColor: s.color==='blue'?'#3b82f6':s.color==='green'?'#10b981':s.color==='purple'?'#8b5cf6':'#f59e0b' }}>
            <p className="font-display text-2xl font-bold text-slate-100">{isLoading?'—':s.count}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Signals Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40"><Spinner size={24}/></div>
      ) : signals.length === 0 ? (
        <div className="card p-8 text-center">
          <Zap size={32} className="text-slate-600 mx-auto mb-3"/>
          <p className="font-semibold text-slate-400">No signals yet</p>
          <p className="text-sm text-slate-600 mt-1">
            <Link href="/dashboard/lead-discovery" className="text-blue-400 hover:underline">Run an AI scan</Link> to detect intent signals
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {signals.map((s: any, i: number) => (
            <div key={i} className="card p-4 hover:border-slate-600/50 transition-colors cursor-pointer"
              style={{ borderLeft:`3px solid ${borderColors[s.signalType]??'#334155'}` }}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-300">
                    {s.companyName?.charAt(0).toUpperCase() ?? '?'}
                  </div>
                  <p className="text-sm font-semibold text-slate-200">{s.companyName}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge color={signalColors[s.signalType]??'gray'}>{s.signalType}</Badge>
                  <span className={`text-xs font-bold ${s.confidence>=80?'text-emerald-400':'text-amber-400'}`}>{s.confidence}%</span>
                </div>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed mb-2 line-clamp-2">{s.signalText}</p>
              <p className="text-[10px] text-slate-600">{timeAgo(s.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
