'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignsApi } from '../../../lib/api';
import { Spinner, EmptyState } from '../../../components/ui';
import { PageHero } from '../../../components/ui/PageHero';
import { Mail, Plus, Play, Pause, Loader2, Send, CalendarDays } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatDate } from '../../../lib/utils';

export default function CampaignsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => campaignsApi.list().then(r => ({ items: Array.isArray(r.data.data) ? r.data.data : r.data.data?.items ?? [] })),
  });

  const launchMutation = useMutation({
    mutationFn: (id: string) => campaignsApi.launch(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Campaign launched!'); },
    onError: () => toast.error('Launch failed'),
  });

  const campaigns: any[] = data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHero
        icon={Send}
        eyebrow="Outreach"
        title="Email Campaigns"
        subtitle="AI-personalized outreach campaigns"
        tone="violet"
      >
        <button className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-white text-indigo-700 font-semibold text-sm shadow-lg shadow-indigo-900/20 hover:bg-blue-50 hover:-translate-y-px transition-all"><Plus size={16}/> New Campaign</button>
      </PageHero>

      {isLoading ? (
        <div className="flex items-center justify-center h-40"><Spinner size={24}/></div>
      ) : campaigns.length === 0 ? (
        <div className="card overflow-hidden">
          <EmptyState icon={Mail} title="No campaigns yet"
            description="Create your first AI-personalized outreach campaign"
            action={<button className="btn-primary"><Plus size={14}/> Create Campaign</button>}/>
        </div>
      ) : (
        <div className="space-y-4">
          {campaigns.map((c: any) => (
            <div key={c.id} className="card relative overflow-hidden p-5 transition-all duration-200 hover:shadow-lg hover:border-violet-300 dark:hover:border-violet-500/40">
              <div className="pointer-events-none absolute -right-16 -top-16 w-40 h-40 rounded-full bg-violet-500 blur-3xl opacity-[0.08] dark:opacity-[0.12]" />
              <div className="relative flex items-center justify-between flex-wrap gap-3 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-md shadow-violet-500/30 flex items-center justify-center flex-shrink-0">
                    <Mail size={18}/>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink truncate">{c.name}</p>
                    <p className="text-xs text-ink-3 inline-flex items-center gap-1"><CalendarDays size={11}/> Created {formatDate(c.createdAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold capitalize ${c.status==='active' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : c.status==='paused' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : c.status==='draft' ? 'bg-slate-400/10 text-ink-2' : 'bg-blue-500/10 text-blue-700 dark:text-blue-300'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${c.status==='active' ? 'bg-emerald-500 animate-pulse' : c.status==='paused' ? 'bg-amber-500' : c.status==='draft' ? 'bg-slate-400' : 'bg-blue-500'}`}/>
                    {c.status}
                  </span>
                  {c.status === 'draft' && (
                    <button className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors" onClick={() => launchMutation.mutate(c.id)}>
                      {launchMutation.isPending ? <Loader2 size={12} className="animate-spin"/> : <Play size={12}/>} Launch
                    </button>
                  )}
                  {c.status === 'active' && (
                    <button className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors"><Pause size={12}/> Pause</button>
                  )}
                </div>
              </div>
              <div className="relative grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                {[['Sent',c.sentCount],['Opened',c.openCount],['Replied',c.replyCount],['Meetings',c.meetingCount],
                  ['Reply Rate', c.sentCount > 0 ? `${((c.replyCount/c.sentCount)*100).toFixed(1)}%` : '0%']].map(([k,v])=>(
                  <div key={k} className="rounded-xl p-3 text-center bg-slate-50 dark:bg-surface-2 border border-line">
                    <p className="font-display text-xl font-semibold tabular-nums tracking-[-0.02em] text-ink">{v}</p>
                    <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{k}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
