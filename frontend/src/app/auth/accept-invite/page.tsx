'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '../../../store/authStore';
import { invitationsApi } from '../../../lib/api';
import { Sparkles, Eye, EyeOff, Loader2, UserPlus, User, Lock, AlertCircle, AlertTriangle, Radar, TrendingUp, Users } from 'lucide-react';
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
    <AuthShell>
      <div className="card relative overflow-hidden p-8">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-cyan-400" />

        <div className="mb-7">
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/30">
            <UserPlus size={20} />
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.025em] text-ink">Accept Invitation</h1>
          <p className="mt-1.5 text-[13.5px] text-ink-3">Set up your account to join the team</p>
        </div>

        {!token ? (
          <div className="space-y-5">
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>This invitation link is invalid or has expired.</span>
            </div>
            <Link href="/auth/login" className="btn-primary w-full justify-center py-3">Back to Login</Link>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-5 flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-sm text-rose-600 dark:text-rose-400">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="label mb-1.5 block">Full Name <span className="text-rose-500">*</span></label>
                <div className="relative">
                  <User size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 z-10" />
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="input pl-10"
                    placeholder="Your full name"
                    required
                    autoFocus
                  />
                </div>
                {fieldErrors.name && <p className="text-xs text-rose-600 dark:text-rose-400 mt-1.5">{fieldErrors.name}</p>}
              </div>

              <div>
                <label className="label mb-1.5 block">Password <span className="text-rose-500">*</span></label>
                <div className="relative">
                  <Lock size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 z-10" />
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    className="input pl-10 pr-10"
                    placeholder="Min. 8 characters"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 z-10 text-ink-3 transition-colors hover:text-ink dark:hover:text-ink"
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {fieldErrors.password && <p className="text-xs text-rose-600 dark:text-rose-400 mt-1.5">{fieldErrors.password}</p>}
              </div>

              <div>
                <label className="label mb-1.5 block">Confirm Password <span className="text-rose-500">*</span></label>
                <div className="relative">
                  <Lock size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 z-10" />
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={form.confirmPassword}
                    onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
                    className="input pl-10"
                    placeholder="Re-enter your password"
                    required
                  />
                </div>
                {fieldErrors.confirmPassword && <p className="text-xs text-rose-600 dark:text-rose-400 mt-1.5">{fieldErrors.confirmPassword}</p>}
              </div>

              <input
                type="submit"
                value={loading ? 'Setting up account...' : 'Join Team'}
                disabled={loading}
                className="btn-primary w-full mt-2 justify-center py-3 cursor-pointer"
              />
            </form>
          </>
        )}

        <p className="mt-6 border-t border-line pt-5 text-center text-sm text-ink-3">
          Already have an account?{' '}
          <Link href="/auth/login" className="font-medium text-blue-600 dark:text-blue-400 hover:underline">Sign in</Link>
        </p>
      </div>
    </AuthShell>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-canvas">
        <Loader2 size={24} className="animate-spin text-blue-600 dark:text-blue-400" />
      </div>
    }>
      <AcceptInviteForm />
    </Suspense>
  );
}

/* ── Presentational auth layout (UI only) ─────────────────────────────── */
const AUTH_FEATURES = [
  { icon: Radar, title: 'AI-powered lead discovery', desc: 'Surface and enrich prospects that match your ideal customer.' },
  { icon: TrendingUp, title: 'Pipeline & opportunity tracking', desc: 'Follow every deal from first touch to close.' },
  { icon: Users, title: 'Team collaboration', desc: 'Assign leads, share activity and work as one team.' },
];

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas">
      {/* Decorative background */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-32 h-[28rem] w-[28rem] rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute top-1/3 -right-40 h-[30rem] w-[30rem] rounded-full bg-violet-500/15 blur-3xl" />
        <div className="absolute -bottom-48 left-1/3 h-[26rem] w-[26rem] rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute inset-0 opacity-70 dark:opacity-40 [background-image:radial-gradient(rgba(100,116,139,0.20)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_25%,transparent_75%)]" />
      </div>

      <div className="relative flex min-h-screen">
        {/* Brand panel (lg+) — a div, not <aside>, because globals.css repaints `.light aside` white */}
        <div className="relative hidden lg:flex lg:w-[46%] xl:w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 p-12 xl:p-16 text-white">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="absolute -top-24 -right-24 h-80 w-80 rounded-full bg-white/[0.12] blur-3xl" />
            <div className="absolute -bottom-16 -left-20 h-72 w-72 rounded-full bg-cyan-300/20 blur-3xl" />
            <div className="absolute inset-0 opacity-50 [background-image:radial-gradient(rgba(255,255,255,0.22)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
          </div>

          <div className="relative flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <Sparkles size={20} className="text-white" />
            </div>
            <span className="font-display text-xl font-bold tracking-[-0.02em] text-white">LeadForge AI</span>
          </div>

          <div className="relative max-w-md">
            <h2 className="font-display text-4xl font-semibold leading-[1.15] tracking-[-0.03em] text-white">
              Find, qualify and win your next customers.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-white/75">
              One workspace for discovering leads, managing your pipeline and working together as a team.
            </p>
            <ul className="mt-10 space-y-5">
              {AUTH_FEATURES.map(({ icon: Icon, title, desc }) => (
                <li key={title} className="flex items-start gap-3.5">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
                    <Icon size={17} className="text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{title}</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-white/70">{desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="relative text-xs text-white/60">B2B lead generation CRM</p>
        </div>

        {/* Form column */}
        <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-[420px]">
            <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-md shadow-blue-500/30">
                <Sparkles size={20} className="text-white" />
              </div>
              <span className="font-display text-xl font-bold tracking-[-0.02em] text-ink">
                LeadForge AI
              </span>
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
