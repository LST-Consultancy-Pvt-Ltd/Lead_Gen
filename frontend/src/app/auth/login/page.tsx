'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../../store/authStore';
import { authApi } from '../../../lib/api';
import { Sparkles, Eye, EyeOff, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore(s => s.setAuth);
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await authApi.login(form);
      console.log('Login response:', data);
      
      if (data?.data?.user && data?.data?.accessToken && data?.data?.refreshToken) {
        setAuth(data.data.user, data.data.accessToken, data.data.refreshToken);
        toast.success('Login successful!');
        router.replace('/dashboard');
      } else {
        throw new Error('Invalid response format from server');
      }
    } catch (err: any) {
      console.error('Login error:', err);
      const errorMessage = err.response?.data?.message || 
                          err.message || 
                          'Login failed. Please check your credentials and try again.';
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#060b18] p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center">
            <Sparkles size={20} className="text-white"/>
          </div>
          <span className="font-display font-bold text-xl bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
            LeadForge AI
          </span>
        </div>

        <div className="card p-8">
          <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100 mb-1">Welcome back</h1>
          <p className="text-sm text-slate-500 mb-6">Sign in to your account</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label mb-1.5 block">Email</label>
              <input type="email" required value={form.email}
                onChange={e => setForm({...form, email: e.target.value})}
                className="input" placeholder="you@company.com"/>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="label">Password</label>
                <Link href="/auth/forgot-password" className="text-xs text-blue-400 hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} required value={form.password}
                  onChange={e => setForm({...form, password: e.target.value})}
                  className="input pr-10" placeholder="••••••••"/>
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
                  {showPw ? <EyeOff size={15}/> : <Eye size={15}/>}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
              {loading ? <Loader2 size={15} className="animate-spin"/> : 'Sign In'}
            </button>
          </form>

          <div className="mt-4 text-center text-sm text-slate-500">
            Don't have an account?{' '}
            <Link href="/auth/register" className="text-blue-400 hover:underline">Create one</Link>
          </div>
        </div>

        {/* <p className="text-center text-xs text-slate-600 mt-4">
          Demo: admin@demo.com / password123
        </p> */}
      </div>
    </div>
  );
}
