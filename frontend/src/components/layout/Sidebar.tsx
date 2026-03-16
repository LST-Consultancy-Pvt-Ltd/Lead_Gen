'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../lib/utils';
import { Avatar } from '../../components/ui';
import { useAuthStore } from '../../store/authStore';
import { getInitials } from '../../lib/utils';
import {
  LayoutDashboard, Search, Users, Zap, Mail, GitBranch,
  BarChart3, UserCog, Plug2, Settings, Sparkles
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/lead-discovery', label: 'Lead Discovery', icon: Search },
  { href: '/dashboard/leads', label: 'Leads CRM', icon: Users },
  { href: '/dashboard/intent-signals', label: 'Intent Signals', icon: Zap },
  { href: '/dashboard/email-campaigns', label: 'Email Campaigns', icon: Mail },
  { href: '/dashboard/sequences', label: 'Sequences', icon: GitBranch },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/dashboard/team', label: 'Team', icon: UserCog },
  { href: '/dashboard/integrations', label: 'Integrations', icon: Plug2 },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  const user = useAuthStore(s => s.user);

  return (
    <aside className={cn(
      'flex flex-col bg-slate-950 border-r border-white/[0.06] transition-all duration-300 flex-shrink-0',
      collapsed ? 'w-16' : 'w-56'
    )}>
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-5 border-b border-white/[0.06]">
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
      <div className="px-3 py-3 border-t border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <Avatar initials={user ? getInitials(user.name) : 'U'} size="sm"/>
          {!collapsed && user && (
            <div className="overflow-hidden">
              <p className="text-xs font-semibold text-slate-200 truncate">{user.name}</p>
              <p className="text-[10px] text-slate-500 truncate capitalize">{user.role.replace('_',' ')}</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
