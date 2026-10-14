'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../store/authStore';
import { Sidebar } from '../../components/layout/Sidebar';
import { Header }from '../../components/layout/Header'
import {Spinner} from "../../components/ui/index";
import { Sparkles } from "lucide-react";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const hasHydrated = useAuthStore(s => s._hasHydrated);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Only redirect after hydration is complete
  useEffect(() => {
    if (mounted && hasHydrated && !isAuthenticated) {
      router.replace('/auth/login');
    }
  }, [mounted, hasHydrated, isAuthenticated, router]);

  // Show loading until hydration is complete
  if (!mounted || !hasHydrated) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-canvas">
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-blue-500/30 blur-xl animate-pulse" />
          <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-600/30">
            <Sparkles size={24} className="text-white" />
          </div>
        </div>
        <Spinner size={20}/>
      </div>
    );
  }

  // Show loading if not authenticated (while redirecting)
  if (!isAuthenticated) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-canvas">
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-blue-500/30 blur-xl animate-pulse" />
          <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-600/30">
            <Sparkles size={24} className="text-white" />
          </div>
        </div>
        <Spinner size={20}/>
      </div>
    );
  }

    return (
    <div className="h-screen flex overflow-hidden bg-slate-50 dark:bg-canvas bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(59,130,246,0.08),transparent)] dark:bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(59,130,246,0.12),transparent)]">
      <Sidebar collapsed={collapsed}/>
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onToggleSidebar={() => setCollapsed(!collapsed)}/>
        <main className="flex-1 overflow-y-auto p-4 sm:p-5 lg:p-6 animate-fade-in">
          {children}
        </main>
      </div>
    </div>
  );
}
