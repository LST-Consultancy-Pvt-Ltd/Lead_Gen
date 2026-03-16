'use client';
import { Plug2, Mail, Calendar, Database, Zap, Globe, Cpu, BarChart3, CheckCircle2 } from 'lucide-react';
import { Badge } from '../../../components/ui';
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
      <div>
        <h1 className="page-title">Integrations</h1>
        <p className="text-sm text-slate-500 mt-1">Connect your tools to supercharge AI lead discovery</p>
      </div>

      {categories.map(cat => (
        <div key={cat}>
          <h2 className="label mb-3">{cat}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {INTEGRATIONS.filter(i => i.cat === cat).map(int => (
              <div key={int.name} className="card p-4 hover:border-slate-600/50 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400">
                    <int.icon size={18}/>
                  </div>
                  <Badge color={int.connected ? 'green' : 'gray'}>{int.connected ? 'Connected' : 'Not Connected'}</Badge>
                </div>
                <p className="font-semibold text-slate-200 mb-1">{int.name}</p>
                <p className="text-xs text-slate-500 mb-4">{int.desc}</p>
                <button
                  onClick={() => int.connected ? null : handleConnect(int.name)}
                  className={int.connected ? 'btn-ghost w-full justify-center text-xs' : 'btn-primary w-full justify-center text-xs'}>
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
