'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../store/authStore';
import { Sidebar } from '../../components/layout/Sidebar';
import { Header }from '../../components/layout/Header'
import {Spinner} from "../../components/ui/index";

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
      <div className="h-screen flex items-center justify-center bg-slate-950">
        <Spinner size={24}/>
      </div>
    );
  }

  // Show loading if not authenticated (while redirecting)
  if (!isAuthenticated) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-950">
        <Spinner size={24}/>
      </div>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden bg-[#060b18]">
      <Sidebar collapsed={collapsed}/>
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onToggleSidebar={() => setCollapsed(!collapsed)}/>
        <main className="flex-1 overflow-y-auto p-6 animate-fade-in">
          {children}
        </main>
      </div>
    </div>
  );
}
