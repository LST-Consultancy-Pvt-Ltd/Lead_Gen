'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignsApi } from '../../../lib/api';
import { Badge, Spinner, EmptyState } from '../../../components/ui';
import { Mail, Plus, Play, Pause, Loader2 } from 'lucide-react';
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
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Email Campaigns</h1>
          <p className="text-sm text-slate-500 mt-1">AI-personalized outreach campaigns</p>
        </div>
        <button className="btn-primary"><Plus size={14}/> New Campaign</button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40"><Spinner size={24}/></div>
      ) : campaigns.length === 0 ? (
        <EmptyState icon={Mail} title="No campaigns yet"
          description="Create your first AI-personalized outreach campaign"
          action={<button className="btn-primary"><Plus size={14}/> Create Campaign</button>}/>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c: any) => (
            <div key={c.id} className="card p-5">
              <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
                    <Mail size={16} className="text-blue-400"/>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-200">{c.name}</p>
                    <p className="text-xs text-slate-500">Created {formatDate(c.createdAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge color={c.status==='active'?'green':c.status==='paused'?'amber':c.status==='draft'?'gray':'blue'}>{c.status}</Badge>
                  {c.status === 'draft' && (
                    <button className="btn-primary text-xs py-1.5" onClick={() => launchMutation.mutate(c.id)}>
                      {launchMutation.isPending ? <Loader2 size={12} className="animate-spin"/> : <Play size={12}/>} Launch
                    </button>
                  )}
                  {c.status === 'active' && (
                    <button className="btn-ghost text-xs py-1.5"><Pause size={12}/> Pause</button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {[['Sent',c.sentCount],['Opened',c.openCount],['Replied',c.replyCount],['Meetings',c.meetingCount],
                  ['Reply Rate', c.sentCount > 0 ? `${((c.replyCount/c.sentCount)*100).toFixed(1)}%` : '0%']].map(([k,v])=>(
                  <div key={k} className="bg-slate-100 dark:bg-slate-950 rounded-xl p-3 text-center">
                    <p className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">{v}</p>
                    <p className="text-xs text-slate-500">{k}</p>
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
