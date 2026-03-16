'use client';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi, discoveryApi } from '../../lib/api';
import { StatCard, Badge, Avatar, ScoreRing, ProgressBar, Spinner } from '../../components/ui';
import { getInitials, timeAgo } from '../../lib/utils';
import { Zap, Users, Mail, TrendingUp, Calendar, Target, Globe, Cpu, Play } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import Link from 'next/link';

export default function DashboardPage() {
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);

  const { data: overview, isLoading } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: () => analyticsApi.overview().then(r => r.data.data),
  });

  const { data: signals } = useQuery({
    queryKey: ['intent-signals'],
    queryFn: () => discoveryApi.getSignals({ limit: 6 }).then(r => ({ items: Array.isArray(r.data.data) ? r.data.data : r.data.data?.items ?? [] })),
  });

  async function handleScan() {
    setScanning(true);
    setScanProgress(0);
    try {
      await discoveryApi.startScan();
      // Simulate progress polling
      const interval = setInterval(() => {
        setScanProgress(p => {
          if (p >= 95) { clearInterval(interval); return 95; }
          return p + Math.floor(Math.random() * 8) + 2;
        });
      }, 600);
      toast.success('AI scan started! Check Lead Discovery for results.');
    } catch {
      toast.error('Failed to start scan');
      setScanning(false);
    }
  }

  const stats = [
    { label: 'Leads Discovered', value: overview?.totalLeads ?? '—', delta: `+${overview?.leadsToday ?? 0} today`, icon: Users, positive: true },
    { label: 'High Intent Leads', value: overview?.hotLeads ?? '—', delta: `+${overview?.hotToday ?? 0} today`, icon: Zap, positive: true },
    { label: 'Emails Sent', value: overview?.emailsSent ?? '—', delta: `+${overview?.emailsToday ?? 0} today`, icon: Mail, positive: true },
    { label: 'Reply Rate', value: overview?.replyRate ? `${overview.replyRate}%` : '—', delta: overview?.replyRateDelta ?? '', icon: TrendingUp, positive: true },
    { label: 'Meetings Booked', value: overview?.meetingsBooked ?? '—', delta: `+${overview?.meetingsToday ?? 0} today`, icon: Calendar, positive: true },
    { label: 'Conversion Rate', value: overview?.conversionRate ? `${overview.conversionRate}%` : '—', delta: '↑ improving', icon: Target, positive: true },
  ];

  if (isLoading) return (
    <div className="flex items-center justify-center h-64"><Spinner size={24}/></div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">AI Sales Intelligence</h1>
          <p className="text-sm text-slate-500 mt-1">Your autonomous lead discovery engine is running 24/7</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/lead-discovery" className="btn-ghost">Configure Services</Link>
          <button className="btn-primary" onClick={handleScan} disabled={scanning}>
            <Zap size={14}/> {scanning ? `Scanning… ${scanProgress}%` : 'Run AI Scan'}
          </button>
        </div>
      </div>

      {/* Scan Progress */}
      {scanning && (
        <div className="card p-4 border-blue-500/30 bg-blue-500/[0.04]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"/>
              <span className="text-sm font-semibold text-blue-300">AI scanning the internet for leads…</span>
            </div>
            <span className="text-xs text-slate-500">{scanProgress}%</span>
          </div>
          <ProgressBar value={scanProgress} color="blue"/>
          <div className="flex flex-wrap gap-3 mt-3">
            {['LinkedIn','Job Boards','Crunchbase','Tech Signals','News','Reddit','GitHub'].map((s, i) => (
              <span key={s} className={`text-xs ${i < scanProgress / 14 ? 'text-emerald-400' : 'text-slate-600'}`}>
                {i < scanProgress / 14 ? '✓' : '○'} {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {stats.map(s => <StatCard key={s.label} {...s}/>)}
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent Leads */}
        <div className="lg:col-span-2 card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">Top Discovered Leads</h2>
            <Link href="/dashboard/leads" className="text-xs text-blue-400 hover:underline">View All →</Link>
          </div>
          {overview?.topLeads?.length ? (
            <div className="space-y-2">
              {overview.topLeads.map((l: any) => (
                <Link key={l.id} href={`/dashboard/leads/${l.id}`}
                  className="flex items-center gap-3 p-3 rounded-xl bg-slate-950 hover:bg-slate-800/60 transition-colors">
                  <Avatar initials={getInitials(l.companyName)} size="sm"/>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-200 truncate">{l.companyName}</p>
                    <p className="text-xs text-slate-500">{l.industry} · {l.companySize} emp</p>
                  </div>
                  <ScoreRing score={l.leadScore} size={36}/>
                  <Badge color={l.intentLevel === 'hot' ? 'red' : l.intentLevel === 'warm' ? 'amber' : 'gray'}>
                    {l.intentLevel === 'hot' ? '🔥 Hot' : l.intentLevel === 'warm' ? 'Warm' : 'Cold'}
                  </Badge>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-10 text-slate-500 text-sm">
              No leads yet.{' '}
              <Link href="/dashboard/lead-discovery" className="text-blue-400 hover:underline">Run a scan</Link>
            </div>
          )}
        </div>

        {/* Live Signals */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">Live Intent Signals</h2>
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-dot"/>
          </div>
          {signals?.items?.length ? (
            <div className="space-y-2">
              {signals.items.map((s: any, i: number) => {
                const borderColors: Record<string,string> = { hiring:'#3b82f6', funding:'#10b981', tech:'#8b5cf6', social:'#f59e0b' };
                return (
                  <div key={i} className="p-2.5 rounded-xl bg-slate-950"
                    style={{ borderLeft:`2px solid ${borderColors[s.signalType] ?? '#334155'}` }}>
                    <p className="text-xs font-semibold text-slate-200 mb-0.5">{s.companyName}</p>
                    <p className="text-xs text-slate-500 line-clamp-2">{s.signalText}</p>
                    <p className="text-[10px] text-slate-600 mt-1">{timeAgo(s.createdAt)}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-500 text-center py-8">No signals yet. Run a scan.</p>
          )}
        </div>
      </div>

      {/* Autopilot Banner */}
      <div className="card p-5 bg-gradient-to-r from-blue-600/10 to-cyan-500/5 border-blue-500/20">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center">
              <Cpu size={20} className="text-white"/>
            </div>
            <div>
              <p className="font-semibold text-slate-100">AI Lead Discovery Autopilot</p>
              <p className="text-xs text-blue-400 mt-0.5">Scanning LinkedIn · Job Boards · News · GitHub · Reddit</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="font-display text-2xl font-bold text-cyan-400">{overview?.totalLeads?.toLocaleString() ?? '—'}</p>
              <p className="text-xs text-slate-500">total leads indexed</p>
            </div>
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-dot"/>
          </div>
        </div>
      </div>
    </div>
  );
}
