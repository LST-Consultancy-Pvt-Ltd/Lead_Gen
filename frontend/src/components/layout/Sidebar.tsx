'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../lib/utils';
import { Avatar } from '../../components/ui';
import { useAuthStore } from '../../store/authStore';
import { usePermissions } from '../../lib/rbac';
import { getInitials } from '../../lib/utils';
import {
  LayoutDashboard, Users, TrendingUp, CheckSquare,
  BarChart3, UserCog, Sparkles, Upload, DollarSign, Search, Zap,
  Building2, UserCircle, Megaphone, Settings
} from 'lucide-react';

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  const user = useAuthStore(s => s.user);
  const { isAdmin, isManager, canImportData } = usePermissions();
  const canViewTeam = isAdmin || isManager;

  const navItems = [
    { href: '/dashboard',                label: 'Dashboard',      icon: LayoutDashboard, show: true },
    { href: '/dashboard/lead-discovery', label: 'Lead Discovery', icon: Search,          show: canViewTeam },
    { href: '/dashboard/opportunities',  label: 'Opportunities',  icon: DollarSign,      show: true },
    { href: '/dashboard/activities',     label: 'Activities',     icon: CheckSquare,     show: true },
    { href: '/dashboard/leads',          label: 'Leads',      icon: Users,           show: true },
    { href: '/dashboard/intent-signals', label: 'Intent Signals', icon: Zap,             show: canViewTeam },
    // { href: '/dashboard/campaigns',      label: 'Campaigns',      icon: Megaphone,       show: isAdmin },
    // { href: '/dashboard/analytics',      label: 'Analytics',      icon: BarChart3,       show: canViewTeam },
    { href: '/dashboard/team',           label: 'Team',           icon: UserCog,         show: canViewTeam },
    { href: '/dashboard/settings',       label: 'Settings',       icon: Settings,        show: isAdmin },
    // { href: '/dashboard/integrations',   label: 'Integrations',   icon: TrendingUp,      show: isAdmin },
  ].filter(item => item.show);

  return (
    <aside className={cn(
      'flex flex-col bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-white/[0.06] transition-all duration-300 flex-shrink-0',
      collapsed ? 'w-16' : 'w-56'
    )}>
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-5 border-b border-slate-200 dark:border-white/[0.06]">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center flex-shrink-0">
          <Sparkles size={16} className="text-white"/>
        </div>
        {!collapsed && (
          <span className="font-display font-bold text-sm bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent whitespace-nowrap">
            LeadForge AI
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link key={href} href={href}
              className={cn('nav-link', active && 'nav-link-active', collapsed && 'justify-center px-2')}>
              <Icon size={17} className="flex-shrink-0"/>
              {!collapsed && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User / Quota info at the bottom */}
      {!collapsed && user?.leadQuota && (
        <div className="px-4 pb-4 pt-2 mt-auto border-t border-slate-200 dark:border-white/[0.06]">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Leads Used</span>
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">
              {user.leadQuota.used} <span className="font-medium text-slate-400 dark:text-slate-500">/ {user.leadQuota.quota}</span>
            </span>
          </div>
          <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all duration-500 ${
                user.leadQuota.used >= user.leadQuota.quota 
                  ? 'bg-red-500' 
                  : user.leadQuota.used >= user.leadQuota.quota * 0.8 
                    ? 'bg-amber-400' 
                    : 'bg-gradient-to-r from-blue-500 to-cyan-500'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, (user.leadQuota.used / user.leadQuota.quota) * 100))}%` }}
            />
          </div>
        </div>
      )}
    </aside>
  );
}
