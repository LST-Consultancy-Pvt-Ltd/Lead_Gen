'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '../../../lib/api';
import { Sparkles, Loader2, Mail, KeyRound, ArrowLeft, Radar, TrendingUp, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await authApi.forgotPassword({ email });
      toast.success('OTP sent to your email.');
      router.push(`/auth/reset-otp?email=${encodeURIComponent(email)}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to send OTP. Please try again.');
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
            <KeyRound size={20} />
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.025em] text-ink">Forgot password?</h1>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-3">
            Enter your registered email. We'll send a OTP to reset your password.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="label mb-1.5 block">Work Email</label>
            <div className="relative">
              <Mail size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 z-10" />
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="input pl-10"
                placeholder="you@company.com"
              />
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3">
            {loading ? <Loader2 size={15} className="animate-spin" /> : 'Send OTP'}
          </button>
        </form>

        <div className="mt-6 border-t border-line pt-5 text-center text-sm">
          <Link href="/auth/login" className="inline-flex items-center gap-1.5 font-medium text-blue-600 dark:text-blue-400 hover:underline">
            <ArrowLeft size={14} />
            Back to login
          </Link>
        </div>
      </div>
    </AuthShell>
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
