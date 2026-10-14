'use client';
import { useState, useRef, useEffect, KeyboardEvent, ClipboardEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi } from '../../../lib/api';
import { Sparkles, Loader2, ShieldCheck, RefreshCw, AlertCircle, ArrowLeft, Radar, TrendingUp, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import Link from 'next/link';
 
function ResetOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';
 
  const [digits, setDigits] = useState(['', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(60);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
 
  useEffect(() => {
    if (resendCooldown > 0) {
      const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [resendCooldown]);
 
  function handleChange(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    setError('');
    if (digit && index < 3) inputRefs.current[index + 1]?.focus();
  }
 
  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }
 
  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    const next = ['', '', '', ''];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    setError('');
    inputRefs.current[Math.min(pasted.length, 3)]?.focus();
  }
 
  async function handleVerify() {
    const otp = digits.join('');
    if (otp.length < 4) {
      setError('Please enter the complete 4-digit OTP.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await authApi.verifyResetOtp({ email, otp });
      // Backend returns a short-lived reset token to authorize the password change
      const resetToken: string = data?.data?.resetToken || data?.resetToken || '';
      toast.success('OTP verified! Set your new password.');
      router.push(
        `/auth/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(resetToken)}`
      );
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Invalid OTP. Please try again.';
      setError(msg);
      setDigits(['', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }
 
  async function handleResend() {
    if (resendCooldown > 0 || resending) return;
    setResending(true);
    setError('');
    try {
      await authApi.forgotPassword({ email });
      toast.success('New OTP sent to your email.');
      setDigits(['', '', '', '']);
      inputRefs.current[0]?.focus();
      setResendCooldown(60);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to resend OTP.');
    } finally {
      setResending(false);
    }
  }
 
  return (
    <AuthShell>
      <div className="card relative overflow-hidden p-8">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-cyan-400" />

        {/* Icon + heading */}
        <div className="flex flex-col items-center text-center mb-7">
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/30">
            <ShieldCheck size={20} />
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.025em] text-ink">Enter OTP</h1>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-3">
            We sent a 4-digit code to<br />
            <span className="font-medium text-ink">{email || 'your email'}</span>
          </p>
        </div>

        {/* OTP inputs */}
        <div className="flex justify-center gap-3 sm:gap-4 mb-2">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={el => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={d}
              aria-label={`OTP digit ${i + 1}`}
              title={`OTP digit ${i + 1}`}
              autoFocus={i === 0}
              onChange={e => handleChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              onPaste={handlePaste}
              className={[
                'w-14 h-14 sm:w-16 sm:h-16 text-center font-display text-2xl font-semibold rounded-xl border bg-white dark:bg-sunken text-ink shadow-sm dark:shadow-none outline-none transition-all duration-200',
                'focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15',
                error
                  ? 'border-rose-500 dark:border-rose-500/70 ring-4 ring-rose-500/10'
                  : 'border-line dark:border-[rgba(148,163,184,0.18)] hover:border-[#cbd5e1] dark:hover:border-[rgba(148,163,184,0.35)]',
              ].join(' ')}
            />
          ))}
        </div>

        {/* Error message */}
        {error && (
          <p className="flex items-center justify-center gap-1.5 text-center text-sm text-rose-600 dark:text-rose-400 mt-3 mb-1">
            <AlertCircle size={14} className="shrink-0" />
            {error}
          </p>
        )}

        {/* Verify button */}
        <button
          onClick={handleVerify}
          disabled={loading || digits.join('').length < 4}
          className="btn-primary w-full justify-center py-3 mt-5"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : 'Verify OTP'}
        </button>

        {/* Resend */}
        <div className="mt-5 text-center text-sm text-ink-3">
          Didn&apos;t receive the code?{' '}
          {resendCooldown > 0 ? (
            <span className="font-medium tabular-nums text-ink-2">Resend in {resendCooldown}s</span>
          ) : (
            <button
              onClick={handleResend}
              disabled={resending}
              className="font-medium text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 disabled:opacity-50"
            >
              {resending && <RefreshCw size={12} className="animate-spin" />}
              Resend OTP
            </button>
          )}
        </div>

        <div className="mt-6 border-t border-line pt-5 text-center text-sm">
          <Link href="/auth/forgot-password" className="inline-flex items-center gap-1.5 font-medium text-blue-600 dark:text-blue-400 hover:underline">
            <ArrowLeft size={14} />
            Change email
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
 
export default function ResetOtpPage() {
  return (
    <Suspense>
      <ResetOtpForm />
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
