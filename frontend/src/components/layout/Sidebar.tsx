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
    // { href: '/dashboard/intent-signals', label: 'Intent Signals', icon: Zap,             show: canViewTeam },
    // { href: '/dashboard/campaigns',      label: 'Campaigns',      icon: Megaphone,       show: isAdmin },
    // { href: '/dashboard/analytics',      label: 'Analytics',      icon: BarChart3,       show: canViewTeam },
    { href: '/dashboard/team',           label: 'Team',           icon: UserCog,         show: true },
    { href: '/dashboard/settings',       label: 'Settings',       icon: Settings,        show: isAdmin },
    // { href: '/dashboard/integrations',   label: 'Integrations',   icon: TrendingUp,      show: isAdmin },
  ].filter(item => item.show);

  return (
    <aside className={cn(
      'relative flex flex-col bg-white dark:bg-chrome border-r border-slate-200/80 dark:border-white/[0.06] transition-all duration-300 flex-shrink-0',
      collapsed ? 'w-[72px]' : 'w-64'
    )}>
      {/* Logo */}
      <div className={cn('flex items-center gap-3 h-16 border-b border-slate-200/80 dark:border-white/[0.06]', collapsed ? 'justify-center px-2' : 'px-5')}>
        <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-600/30">
          <Sparkles size={17} className="text-white"/>
        </div>
        {!collapsed && (
          <div className="flex flex-col leading-none whitespace-nowrap">
            <span className="font-display font-bold text-[15px] tracking-tight text-slate-900 dark:text-white">
              LeadForge <span className="bg-gradient-to-r from-blue-600 to-indigo-500 dark:from-blue-400 dark:to-cyan-300 bg-clip-text text-transparent">AI</span>
            </span>
            <span className="mt-1 text-[10px] font-medium text-slate-400 dark:text-slate-500">Sales Intelligence</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className={cn('flex-1 overflow-y-auto py-4 space-y-1', collapsed ? 'px-3' : 'px-3')}>
        {!collapsed && (
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Menu</p>
        )}
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link key={href} href={href} title={collapsed ? label : undefined}
              className={cn('nav-link group', active && 'nav-link-active', collapsed && 'justify-center px-2')}>
              {active && !collapsed && (
                <span className="absolute -left-3 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full bg-gradient-to-b from-blue-500 to-indigo-500"/>
              )}
              <span className={cn(
                'flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 transition-colors',
                active
                  ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-200'
              )}>
                <Icon size={17}/>
              </span>
              {!collapsed && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User / Quota info at the bottom */}
      {!collapsed && user?.leadQuota && (
        <div className="p-3 mt-auto">
          <div className="rounded-2xl p-4 border border-blue-500/15 bg-gradient-to-br from-blue-50 to-indigo-50/60 dark:from-blue-500/[0.08] dark:to-indigo-500/[0.04]">
          <div className="flex justify-between items-center mb-2.5">
            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-[0.12em]">Leads Used</span>
            <span className="text-xs font-bold text-slate-800 dark:text-white">
              {user.leadQuota.used} <span className="font-medium text-slate-400 dark:text-slate-500">/ {user.leadQuota.quota}</span>
            </span>
          </div>
          <div className="h-2 w-full bg-white dark:bg-white/[0.06] rounded-full overflow-hidden ring-1 ring-slate-200/70 dark:ring-0">
            <div 
              className={`h-full rounded-full transition-all duration-500 ${
                user.leadQuota.used >= user.leadQuota.quota 
                  ? 'bg-red-500' 
                  : user.leadQuota.used >= user.leadQuota.quota * 0.8 
                    ? 'bg-amber-400' 
                    : 'bg-gradient-to-r from-blue-500 to-indigo-500'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, (user.leadQuota.used / user.leadQuota.quota) * 100))}%` }}
            />
          </div>
          </div>
        </div>
      )}
    </aside>
  );
}
