'use client';
import { useState } from 'react';
import { useAuthStore } from '../../../store/authStore';
import { Badge } from '../../../components/ui';
import { CheckCircle2, Save, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const user = useAuthStore(s => s.user);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await new Promise(r => setTimeout(r, 800));
    setSaving(false);
    toast.success('Settings saved');
  }

  const sections = [
    {
      title: 'Organization',
      fields: [
        { label:'Company Name', value: user?.organization?.name ?? '', placeholder:'Acme Corp' },
        { label:'Website', value:'', placeholder:'acmecorp.com' },
        { label:'Industry', value:'', placeholder:'Technology' },
      ],
    },
    {
      title: 'AI Configuration',
      fields: [
        { label:'Scan Frequency', value:'Daily', placeholder:'' },
        { label:'Max Leads per Day', value:'100', placeholder:'' },
        { label:'Min Intent Score', value:'60', placeholder:'' },
      ],
    },
  ];

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">Configure your organization and AI preferences</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sections.map(sec => (
          <div key={sec.title} className="card p-5">
            <h2 className="section-title mb-4">{sec.title}</h2>
            <div className="space-y-3">
              {sec.fields.map(f => (
                <div key={f.label}>
                  <label className="label mb-1.5 block">{f.label}</label>
                  <input className="input text-sm" defaultValue={f.value} placeholder={f.placeholder}/>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="card p-5">
          <h2 className="section-title mb-4">Account Security</h2>
          <div className="space-y-3">
            {[['Email', user?.email ?? '—', 'blue'],['Role', user?.role?.replace('_',' ') ?? '—', 'green'],['2FA', 'Not Enabled', 'gray'],['OAuth', 'Google Connected', 'green']].map(([k,v,c])=>(
              <div key={k} className="flex justify-between items-center py-2 border-b border-white/[0.04]">
                <span className="text-sm text-slate-400">{k}</span>
                <Badge color={c as any}>{v}</Badge>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="section-title mb-4">Profile</h2>
          <div className="space-y-3">
            <div><label className="label mb-1.5 block">Full Name</label><input className="input text-sm" defaultValue={user?.name}/></div>
            <div><label className="label mb-1.5 block">Email</label><input className="input text-sm" defaultValue={user?.email} disabled /></div>
            <div><label className="label mb-1.5 block">New Password</label><input type="password" className="input text-sm" placeholder="Leave blank to keep current"/></div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button className="btn-primary px-8 py-2.5" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>} Save Changes
        </button>
      </div>
    </div>
  );
}
