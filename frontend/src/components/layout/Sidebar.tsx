'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../lib/utils';
import { Avatar } from '../../components/ui';
import { useAuthStore } from '../../store/authStore';
import { usePermissions, getRoleLabel } from '../../lib/rbac';
import { getInitials } from '../../lib/utils';
import {
  LayoutDashboard, Users, TrendingUp, CheckSquare, GitBranch,
  BarChart3, UserCog, Settings, Sparkles, Upload, DollarSign, Search, Zap,
  Building2, UserCircle, Megaphone
} from 'lucide-react';

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  const user = useAuthStore(s => s.user);
  const { isAdmin, isManager, canImportData } = usePermissions();
  const canViewTeam = isAdmin || isManager;

  const navItems = [
    { href: '/dashboard',               label: 'Dashboard',      icon: LayoutDashboard, show: true },
    { href: '/dashboard/leads',          label: 'Leads',     icon: Users,           show: true },
    { href: '/dashboard/opportunities',  label: 'Opportunities', icon: DollarSign,      show: true },
    { href: '/dashboard/activities',     label: 'Activities',    icon: CheckSquare,     show: true },
    { href: '/dashboard/lead-discovery',label: 'Lead Discovery', icon: Search,          show: canViewTeam },
    { href: '/dashboard/intent-signals', label: 'Intent Signals',icon: Zap,             show: canViewTeam },
    { href: '/dashboard/team',           label: 'Team',          icon: UserCog,         show: canViewTeam },
    { href: '/dashboard/settings',       label: 'Settings',      icon: Settings,        show: isAdmin },
    // { href: '/dashboard/accounts',       label: 'Accounts',      icon: Building2,       show: isAdmin },
    // { href: '/dashboard/contacts',       label: 'Contacts',      icon: UserCircle,      show: isAdmin },
    // { href: '/dashboard/campaigns',      label: 'Campaigns',     icon: Megaphone,       show: isAdmin },
    // { href: '/dashboard/analytics',      label: 'Analytics',     icon: BarChart3,       show: canViewTeam },
    // { href: '/dashboard/import',         label: 'Import Data',   icon: Upload,          show: canImportData },
    // { href: '/dashboard/integrations',   label: 'Integrations',  icon: TrendingUp,      show: isAdmin },
  ].filter(item => item.show);

  const roleBadgeClass = isAdmin
    ? 'bg-emerald-500/15 text-emerald-400'
    : isManager
    ? 'bg-blue-500/15 text-blue-400'
    : 'bg-slate-500/15 text-slate-400';

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

      {/* User */}
      <div className="px-3 py-3 border-t border-slate-200 dark:border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <Avatar initials={user ? getInitials(user.name) : 'U'} size="sm"/>
          {!collapsed && user && (
            <div className="overflow-hidden">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{user.name}</p>
              <span className={cn('inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded-full mt-0.5 leading-tight', roleBadgeClass)}>
                {getRoleLabel(user.role)}
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
