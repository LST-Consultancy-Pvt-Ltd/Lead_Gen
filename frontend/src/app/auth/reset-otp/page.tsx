'use client';
import { useState, useRef, useEffect, KeyboardEvent, ClipboardEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi } from '../../../lib/api';
import { Sparkles, Loader2, ShieldCheck, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import Link from 'next/link';

export default function ResetOtpPage() {
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
    <div className="min-h-screen flex items-center justify-center bg-[#060b18] p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center">
            <Sparkles size={20} className="text-white" />
          </div>
          <span className="font-display font-bold text-xl bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
            LeadForge AI
          </span>
        </div>

        <div className="card p-8">
          <div className="flex flex-col items-center mb-6">
            <div className="w-14 h-14 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
              <ShieldCheck size={26} className="text-blue-400" />
            </div>
            <h1 className="font-display text-xl font-bold text-slate-100 mb-1">Enter OTP</h1>
            <p className="text-sm text-slate-400 text-center">
              We sent a 4-digit code to<br />
              <span className="text-slate-200 font-medium">{email || 'your email'}</span>
            </p>
          </div>

          {/* OTP inputs */}
          <div className="flex justify-center gap-3 mb-2">
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
                  'w-14 h-14 text-center text-2xl font-bold rounded-xl border bg-slate-800/60 text-slate-100 outline-none transition-all',
                  'focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
                  error
                    ? 'border-red-500 ring-1 ring-red-500'
                    : 'border-slate-600 hover:border-slate-400',
                ].join(' ')}
              />
            ))}
          </div>

          {error && (
            <p className="text-center text-sm text-red-400 mt-2 mb-1">{error}</p>
          )}

          <button
            onClick={handleVerify}
            disabled={loading || digits.join('').length < 4}
            className="btn-primary w-full justify-center py-2.5 mt-4"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : 'Verify OTP'}
          </button>

          <div className="mt-5 text-center text-sm text-slate-400">
            Didn&apos;t receive the code?{' '}
            {resendCooldown > 0 ? (
              <span className="text-slate-500">Resend in {resendCooldown}s</span>
            ) : (
              <button
                onClick={handleResend}
                disabled={resending}
                className="text-blue-400 hover:underline inline-flex items-center gap-1 disabled:opacity-50"
              >
                {resending && <RefreshCw size={12} className="animate-spin" />}
                Resend OTP
              </button>
            )}
          </div>

          <div className="mt-4 text-center text-sm text-slate-500">
            <Link href="/auth/forgot-password" className="text-blue-400 hover:underline">Change email</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
