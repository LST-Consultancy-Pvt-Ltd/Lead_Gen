'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi } from '../../../lib/api';
import { Sparkles, Loader2, KeyRound, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import Link from 'next/link';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';
  const resetToken = searchParams.get('token') || '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await authApi.resetPassword({ email, resetToken, newPassword });
      toast.success('Password updated successfully! Please log in.');
      router.replace('/auth/login');
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Failed to reset password. Please try again.';
      setError(msg);
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
              <KeyRound size={26} className="text-blue-400" />
            </div>
            <h1 className="font-display text-xl font-bold text-slate-100 mb-1">Set new password</h1>
            <p className="text-sm text-slate-400 text-center">
              Create a strong password for<br />
              <span className="text-slate-200 font-medium">{email}</span>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* New password */}
            <div>
              <label className="label mb-1.5 block">New Password</label>
              <div className="relative">
                <input
                  type={showNew ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={e => { setNewPassword(e.target.value); setError(''); }}
                  className="input pr-10"
                  placeholder="Min. 8 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                >
                  {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Confirm password */}
            <div>
              <label className="label mb-1.5 block">Confirm Password</label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={e => { setConfirmPassword(e.target.value); setError(''); }}
                  className="input pr-10"
                  placeholder="Re-enter password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                >
                  {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Inline error */}
            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center py-2.5"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : 'Update Password'}
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

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
