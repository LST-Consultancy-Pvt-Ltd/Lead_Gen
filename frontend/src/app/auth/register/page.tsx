'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../../store/authStore';
import { authApi } from '../../../lib/api';
import { Sparkles, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Link from 'next/link';

export default function RegisterPage() {
  const router = useRouter();
  const setAuth = useAuthStore(s => s.setAuth);
  const [form, setForm] = useState({ name: '', email: '', password: '', orgName: '' });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await authApi.register(form);
      setAuth(data.data.user, data.data.accessToken, data.data.refreshToken);
      toast.success('Account created! Welcome to LeadForge AI');
      router.replace('/dashboard');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  const fields = [
    { key: 'name', label: 'Full Name', type: 'text', placeholder: 'John Smith' },
    { key: 'orgName', label: 'Company Name', type: 'text', placeholder: 'Acme Corp' },
    { key: 'email', label: 'Work Email', type: 'email', placeholder: 'you@company.com' },
    { key: 'password', label: 'Password', type: 'password', placeholder: '••••••••' },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#060b18] p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center">
            <Sparkles size={20} className="text-white"/>
          </div>
          <span className="font-display font-bold text-xl bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
            LeadForge AI
          </span>
        </div>
        <div className="card p-8">
          <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100 mb-1">Create account</h1>
          <p className="text-sm text-slate-500 mb-6">Start discovering leads in minutes</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            {fields.map(f => (
              <div key={f.key}>
                <label className="label mb-1.5 block">{f.label}</label>
                <input type={f.type} required value={(form as any)[f.key]}
                  onChange={e => setForm({...form, [f.key]: e.target.value})}
                  className="input" placeholder={f.placeholder}/>
              </div>
            ))}
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
              {loading ? <Loader2 size={15} className="animate-spin"/> : 'Create Account'}
            </button>
          </form>
          <div className="mt-4 text-center text-sm text-slate-500">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-blue-400 hover:underline">Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
