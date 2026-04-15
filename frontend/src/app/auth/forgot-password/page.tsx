'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '../../../lib/api';
import { Sparkles, Loader2, Mail } from 'lucide-react';
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
              <Mail size={26} className="text-blue-400" />
            </div>
            <h1 className="font-display text-xl font-bold text-slate-100 mb-1">Forgot password?</h1>
            <p className="text-sm text-slate-400 text-center">
              Enter your registered email. We'll send a OTP to reset your password.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label mb-1.5 block">Work Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="input"
                placeholder="you@company.com"
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
              {loading ? <Loader2 size={15} className="animate-spin" /> : 'Send OTP'}
            </button>
          </form>

          <div className="mt-4 text-center text-sm text-slate-500">
            <Link href="/auth/login" className="text-blue-400 hover:underline">Back to login</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
