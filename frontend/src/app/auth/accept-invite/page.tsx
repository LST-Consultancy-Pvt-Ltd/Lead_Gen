'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '../../../store/authStore';
import { invitationsApi } from '../../../lib/api';
import { Sparkles, Eye, EyeOff, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Link from 'next/link';

function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const setAuth = useAuthStore(s => s.setAuth);

  const [form, setForm] = useState({ name: '', password: '', confirmPassword: '' });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; password?: string; confirmPassword?: string }>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    const nextErrors: { name?: string; password?: string; confirmPassword?: string } = {};

    if (!form.name.trim()) {
      nextErrors.name = 'Full name is required';
    }
    if (form.password.length < 8) {
      nextErrors.password = 'Password must be at least 8 characters';
    }
    if (form.password !== form.confirmPassword) {
      nextErrors.confirmPassword = 'Passwords do not match';
    }
    if (!token) {
      setError('Invalid or missing invitation token. Please use the link from your invitation email.');
      return;
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setLoading(true);
    try {
      const { data } = await invitationsApi.accept({ token, name: form.name, password: form.password });
      const res = data?.data ?? data;
      setAuth(res.user, res.accessToken, res.refreshToken);
      toast.success('Welcome to LeadForge AI!');
      router.replace('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to accept invitation. The link may be expired or invalid.');
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
            <Sparkles size={20} className="text-white" />
          </div>
          <span className="font-display font-bold text-xl bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
            LeadForge AI
          </span>
        </div>

        <div className="card p-8">
          <h1 className="font-display text-xl font-bold text-slate-100 mb-1">Accept Invitation</h1>
          <p className="text-sm text-slate-500 mb-6">Set up your account to join the team</p>

          {!token ? (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-400">
                This invitation link is invalid or has expired.
              </div>
              <Link href="/auth/login" className="btn-primary w-full justify-center">Back to Login</Link>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label mb-1.5 block">Full Name <span className="text-red-400">*</span></label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="input"
                    placeholder="Your full name"
                    required
                    autoFocus
                  />
                  {fieldErrors.name && <p className="text-xs text-red-400 mt-1">{fieldErrors.name}</p>}
                </div>

                <div>
                  <label className="label mb-1.5 block">Password <span className="text-red-400">*</span></label>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      className="input pr-10"
                      placeholder="Min. 8 characters"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {fieldErrors.password && <p className="text-xs text-red-400 mt-1">{fieldErrors.password}</p>}
                </div>

                <div>
                  <label className="label mb-1.5 block">Confirm Password <span className="text-red-400">*</span></label>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={form.confirmPassword}
                    onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
                    className="input"
                    placeholder="Re-enter your password"
                    required
                  />
                  {fieldErrors.confirmPassword && <p className="text-xs text-red-400 mt-1">{fieldErrors.confirmPassword}</p>}
                </div>

                <input
                  type="submit"
                  value={loading ? 'Setting up account...' : 'Join Team'}
                  disabled={loading}
                  className="btn-primary w-full mt-2 justify-center"
                />
              </form>
            </>
          )}

          <p className="text-center text-xs text-slate-600 mt-6">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-blue-400 hover:text-blue-300">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#060b18]">
        <Loader2 size={24} className="animate-spin text-blue-400" />
      </div>
    }>
      <AcceptInviteForm />
    </Suspense>
  );
}
