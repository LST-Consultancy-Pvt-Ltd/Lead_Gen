'use client';
import { useState } from 'react';
import { Bell, Search, Menu, LogOut } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { authApi } from '../../lib/api';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

export function Header({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const user = useAuthStore(s => s.user);
  const clearAuth = useAuthStore(s => s.clearAuth);
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    try { await authApi.logout(); } catch {}
    clearAuth();
    router.replace('/auth/login');
  }

  return (
    <header className="h-14 flex-shrink-0 bg-slate-950 border-b border-white/[0.06] flex items-center justify-between px-4 gap-3">
      <div className="flex items-center gap-3">
        <button onClick={onToggleSidebar} className="btn-ghost p-2">
          <Menu size={16}/>
        </button>
        <div className="relative hidden sm:block">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
          <input className="input pl-8 h-9 w-60 text-xs" placeholder="Search leads, companies…"/>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Autopilot badge */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-dot"/>
          <span className="text-xs font-semibold text-emerald-400">AI Autopilot ON</span>
        </div>

        <button className="btn-ghost p-2 relative">
          <Bell size={16}/>
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500 border-2 border-slate-950"/>
        </button>

        <div className="relative">
          <button onClick={() => setMenuOpen(!menuOpen)} className="flex items-center gap-2 btn-ghost py-1.5 px-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-xs font-bold">
              {user?.name?.charAt(0).toUpperCase() ?? 'U'}
            </div>
            <span className="text-sm text-slate-300 hidden sm:block">{user?.name?.split(' ')[0]}</span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-44 card shadow-xl shadow-black/40 py-1 z-50">
              <button onClick={handleLogout}
                className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 w-full text-left transition-colors">
                <LogOut size={14}/> Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
