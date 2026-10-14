'use client';
import { Plug2, Mail, Calendar, Database, Zap, Globe, Cpu, BarChart3, CheckCircle2, Settings2, Link2 } from 'lucide-react';
import { PageHero } from '../../../components/ui/PageHero';
import toast from 'react-hot-toast';

const INTEGRATIONS = [
  { name:'Gmail', desc:'Send & track emails via Gmail', icon:Mail, connected:false, cat:'Email', url:'/api/auth/google' },
  { name:'Google Calendar', desc:'Auto-book meetings', icon:Calendar, connected:false, cat:'Calendar' },
  { name:'Outlook', desc:'Microsoft email & calendar', icon:Mail, connected:false, cat:'Email' },
  { name:'Salesforce', desc:'Sync leads to CRM', icon:Database, connected:false, cat:'CRM' },
  { name:'HubSpot', desc:'Marketing & CRM automation', icon:Database, connected:false, cat:'CRM' },
  { name:'Slack', desc:'Lead & reply notifications', icon:Zap, connected:false, cat:'Notifications' },
  { name:'LinkedIn', desc:'Profile enrichment', icon:Globe, connected:false, cat:'Enrichment' },
  { name:'Crunchbase', desc:'Funding & company data', icon:BarChart3, connected:false, cat:'Enrichment' },
  { name:'BuiltWith', desc:'Tech stack detection', icon:Cpu, connected:false, cat:'Intelligence' },
  { name:'SerpAPI', desc:'Web search signals', icon:Globe, connected:false, cat:'Intelligence' },
  { name:'OpenAI', desc:'AI lead analysis engine', icon:Zap, connected:true, cat:'AI' },
  { name:'SendGrid', desc:'Transactional email delivery', icon:Mail, connected:true, cat:'Email' },
];

export default function IntegrationsPage() {
  const categories = [...new Set(INTEGRATIONS.map(i => i.cat))];

  function handleConnect(name: string) {
    toast.success(`Opening ${name} OAuth flow…`);
  }

  return (
    <div className="space-y-6">
      <PageHero
        icon={Plug2}
        eyebrow="Workspace"
        title="Integrations"
        subtitle="Connect your tools to supercharge AI lead discovery"
      >
        <span className="inline-flex items-center gap-2 h-10 px-3.5 rounded-xl text-sm font-medium text-white bg-white/10 ring-1 ring-white/20 backdrop-blur">
          <CheckCircle2 size={15} />
          {INTEGRATIONS.filter(i => i.connected).length} of {INTEGRATIONS.length} connected
        </span>
      </PageHero>

      {categories.map(cat => (
        <div key={cat}>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">{cat}</h2>
            <span className="h-px flex-1 bg-line dark:bg-white/[0.06]" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {INTEGRATIONS.filter(i => i.cat === cat).map(int => (
              <div key={int.name} className="card relative overflow-hidden p-5 flex flex-col transition-all duration-200 hover:-translate-y-px hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-500/40">
                {int.connected && <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-emerald-500 to-teal-400" />}
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${int.connected ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30' : 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/30'}`}>
                    <int.icon size={20}/>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold ${int.connected ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-slate-400/10 text-ink-3'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${int.connected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    {int.connected ? 'Connected' : 'Not Connected'}
                  </span>
                </div>
                <p className="font-semibold text-ink mb-1">{int.name}</p>
                <p className="text-xs text-ink-2 mb-5">{int.desc}</p>
                <button
                  onClick={() => int.connected ? null : handleConnect(int.name)}
                  className={int.connected ? 'btn-ghost w-full justify-center text-xs mt-auto' : 'btn-primary w-full justify-center text-xs mt-auto'}>
                  {int.connected ? <Settings2 size={13}/> : <Link2 size={13}/>}
                  {int.connected ? 'Manage' : 'Connect'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
