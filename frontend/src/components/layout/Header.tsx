"use client";
import { useState, useEffect, useRef } from "react";
import {
  Bell,
  Search,
  Menu,
  LogOut,
  Users,
  UserCircle,
  Building2,
  DollarSign,
  X,
  Sun,
  Moon,
  Monitor,
  Settings,
  ChevronRight,
} from "lucide-react";
import { useAuthStore } from "../../store/authStore";
import { useThemeStore } from "../../store/themeStore";
import {
  authApi,
  notificationsApi,
  leadsApi,
  contactsApi,
  accountsApi,
  opportunitiesApi,
} from "../../lib/api";
import { Badge, Spinner } from "../../components/ui";
import { getRoleLabel, getRoleBadgeColor, timeAgo } from "../../lib/utils";
import { usePermissions } from "../../lib/rbac";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function Header({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const { theme, setTheme } = useThemeStore();
  const router = useRouter();
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setSearchQuery("");
      }
      if (
        notificationsRef.current &&
        !notificationsRef.current.contains(e.target as Node)
      ) {
        setNotificationsOpen(false);
      }
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const q = debouncedQuery.trim();
  const searchEnabled = q.length >= 2;

  const leadParams = permissions.canViewAllLeads
    ? { search: q, limit: 5 }
    : { search: q, limit: 5, assignedToMe: true };
  const oppParams = permissions.canViewAllOpportunities
    ? { search: q, limit: 5 }
    : { search: q, limit: 5, assignedToMe: true };

  const { data: leadResults, isFetching: leadsLoading } = useQuery({
    queryKey: ["gs-leads", q, leadParams],
    queryFn: () => leadsApi.list(leadParams).then((r) => r.data?.data ?? []),
    enabled: searchEnabled,
    staleTime: 10_000,
  });
  const { data: contactResults, isFetching: contactsLoading } = useQuery({
    queryKey: ["gs-contacts", q],
    queryFn: () =>
      contactsApi
        .list({ search: q, limit: 5 })
        .then((r) => r.data?.data ?? r.data ?? []),
    enabled: searchEnabled,
    staleTime: 10_000,
  });
  const { data: accountResults, isFetching: accountsLoading } = useQuery({
    queryKey: ["gs-accounts", q],
    queryFn: () =>
      accountsApi
        .list({ search: q, limit: 5 })
        .then((r) => r.data?.data ?? r.data ?? []),
    enabled: searchEnabled,
    staleTime: 10_000,
  });
  const { data: oppResults, isFetching: oppsLoading } = useQuery({
    queryKey: ["gs-opps", q, oppParams],
    queryFn: () =>
      opportunitiesApi
        .list(oppParams)
        .then((r) => r.data?.data ?? r.data ?? []),
    enabled: searchEnabled,
    staleTime: 10_000,
  });

  const leads = Array.isArray(leadResults) ? leadResults : [];
  const contacts = Array.isArray(contactResults) ? contactResults : [];
  const accounts = Array.isArray(accountResults) ? accountResults : [];
  const opps = Array.isArray(oppResults) ? oppResults : [];

  const isLoading =
    leadsLoading || contactsLoading || accountsLoading || oppsLoading;
  const hasResults =
    leads.length > 0 ||
    contacts.length > 0 ||
    accounts.length > 0 ||
    opps.length > 0;
  const showDropdown = searchQuery.trim().length >= 2;

  function navigate(href: string) {
    setSearchQuery("");
    router.push(href);
  }

  const { data: notificationsData } = useQuery({
    queryKey: ["notifications"],
    queryFn: () =>
      notificationsApi.list().then((r) => r.data?.data ?? r.data ?? []),
    refetchInterval: 30000,
  });

  const notifications = Array.isArray(notificationsData)
    ? notificationsData
    : (notificationsData?.items ?? []);
  const unread = notifications.filter((n: any) => !n.isRead);

  const markReadMutation = useMutation({
    mutationFn: (ids: string[]) => notificationsApi.markRead(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Notifications marked as read");
    },
    onError: () => toast.error("Failed to mark notifications as read"),
  });

  async function handleLogout() {
    try {
      await authApi.logout();
    } catch {}
    clearAuth();
    router.replace("/auth/login");
  }

  const themeOptions: { value: 'light' | 'dark' | 'system'; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];

  return (
    <header className="h-14 flex-shrink-0 bg-slate-950 border-b border-white/[0.06] flex items-center justify-between px-4 gap-3">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="btn-ghost p-2"
          title="Toggle sidebar"
        >
          <Menu size={16} />
        </button>
        <div className="relative hidden sm:block" ref={searchContainerRef}>
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none z-10"
          />
          <input
            className="input pl-8 pr-8 h-9 w-64 text-xs"
            placeholder="Search leads, companies…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              onClick={() => setSearchQuery("")}
              title="Clear search"
            >
              <X size={13} />
            </button>
          )}

          {showDropdown && (
            <div className="absolute top-full left-0 mt-1.5 w-96 bg-slate-900 border border-white/10 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden">
              {isLoading && !hasResults ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner size={18} />
                </div>
              ) : !hasResults ? (
                <div className="px-4 py-6 text-center text-xs text-slate-500">
                  No results for &ldquo;{searchQuery.trim()}&rdquo;
                </div>
              ) : (
                <div className="max-h-[420px] overflow-y-auto divide-y divide-white/[0.04]">
                  {leads.length > 0 && (
                    <section>
                      <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                        <Users size={10} /> Leads
                      </p>
                      {leads.map((item: any) => (
                        <button
                          key={item.id}
                          className="w-full text-left px-3 py-2 hover:bg-slate-800/60 flex items-center gap-3 transition-colors"
                          onClick={() =>
                            navigate(`/dashboard/leads/${item.id}`)
                          }
                        >
                          <div className="w-7 h-7 rounded-lg bg-blue-500/15 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-blue-400">
                            {(item.companyName ?? "?")[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-slate-200 truncate">
                              {item.companyName}
                            </p>
                            <p className="text-[10px] text-slate-500 truncate">
                              {item.contactEmail ??
                                item.contactName ??
                                item.industry ??
                                ""}
                            </p>
                          </div>
                        </button>
                      ))}
                    </section>
                  )}

                  {contacts.length > 0 && (
                    <section>
                      <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                        <UserCircle size={10} /> Contacts
                      </p>
                      {contacts.map((item: any) => (
                        <button
                          key={item.id}
                          className="w-full text-left px-3 py-2 hover:bg-slate-800/60 flex items-center gap-3 transition-colors"
                          onClick={() => navigate("/dashboard/contacts")}
                        >
                          <div className="w-7 h-7 rounded-lg bg-purple-500/15 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-purple-400">
                            {(item.name ?? "?")[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-slate-200 truncate">
                              {item.name}
                            </p>
                            <p className="text-[10px] text-slate-500 truncate">
                              {item.email ??
                                item.designation ??
                                item.phone ??
                                ""}
                            </p>
                          </div>
                        </button>
                      ))}
                    </section>
                  )}

                  {accounts.length > 0 && (
                    <section>
                      <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                        <Building2 size={10} /> Accounts
                      </p>
                      {accounts.map((item: any) => (
                        <button
                          key={item.id}
                          className="w-full text-left px-3 py-2 hover:bg-slate-800/60 flex items-center gap-3 transition-colors"
                          onClick={() => navigate("/dashboard/accounts")}
                        >
                          <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-amber-400">
                            {(item.companyName ?? "?")[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-slate-200 truncate">
                              {item.companyName}
                            </p>
                            <p className="text-[10px] text-slate-500 truncate">
                              {item.industry ?? item.website ?? ""}
                            </p>
                          </div>
                        </button>
                      ))}
                    </section>
                  )}

                  {opps.length > 0 && (
                    <section>
                      <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                        <DollarSign size={10} /> Opportunities
                      </p>
                      {opps.map((item: any) => (
                        <button
                          key={item.id}
                          className="w-full text-left px-3 py-2 hover:bg-slate-800/60 flex items-center gap-3 transition-colors"
                          onClick={() => navigate("/dashboard/opportunities")}
                        >
                          <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-emerald-400">
                            {(item.opportunityName ??
                              item.title ??
                              "?")[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-slate-200 truncate">
                              {item.opportunityName ?? item.title}
                            </p>
                            <p className="text-[10px] text-slate-500 truncate">
                              {item.businessLine ??
                                item.lead?.companyName ??
                                ""}
                            </p>
                          </div>
                        </button>
                      ))}
                    </section>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Notifications */}
        <div className="relative" ref={notificationsRef}>
          <button
            className="btn-ghost p-2 relative"
            onClick={() => setNotificationsOpen((v) => !v)}
          >
            <Bell size={16} />
            {unread.length > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-[10px] text-white font-semibold flex items-center justify-center border border-slate-950">
                {unread.length > 99 ? "99+" : unread.length}
              </span>
            )}
          </button>
          {notificationsOpen && (
            <div className="absolute right-0 top-full mt-1 w-80 card shadow-xl shadow-black/40 z-50 overflow-hidden">
              <div className="px-3 py-2 border-b border-white/[0.06]">
                <p className="text-sm font-semibold text-slate-200">
                  Notifications
                </p>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.slice(0, 10).map((n: any) => (
                  <div
                    key={n.id}
                    className={`px-3 py-2 border-b border-white/[0.04] ${!n.isRead ? "bg-blue-500/10" : ""}`}
                  >
                    <p className="text-sm font-semibold text-slate-200">
                      {n.title}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">{n.message}</p>
                    <p className="text-[10px] text-slate-500 mt-1">
                      {n.createdAt ? timeAgo(n.createdAt) : "Just now"}
                    </p>
                  </div>
                ))}
                {notifications.length === 0 && (
                  <div className="px-3 py-8 text-center text-xs text-slate-500">
                    No notifications
                  </div>
                )}
              </div>
              <div className="p-2 border-t border-white/[0.06]">
                <button
                  className="btn-ghost w-full justify-center text-xs"
                  disabled={!unread.length || markReadMutation.isPending}
                  onClick={() =>
                    markReadMutation.mutate(unread.map((n: any) => n.id))
                  }
                >
                  Mark All Read
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Profile Menu */}
        <div className="relative" ref={profileMenuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 btn-ghost py-1.5 px-2"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-xs font-bold">
              {user?.name?.charAt(0).toUpperCase() ?? "U"}
            </div>
            <span className="text-sm text-slate-300 hidden sm:block">
              {user?.name?.split(" ")[0]}
            </span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 card shadow-xl shadow-black/40 py-1 z-50">
              {/* User info + role */}
              <div className="px-3 py-2.5 border-b border-white/[0.06]">
                <p className="text-sm font-semibold text-slate-200 truncate">{user?.name}</p>
                <p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
                <Badge color={getRoleBadgeColor(user?.role || '')} className="mt-1.5">
                  {getRoleLabel(user?.role || '')}
                </Badge>
              </div>

              {/* Theme Switcher */}
              <div className="px-3 py-2.5 border-b border-white/[0.06]">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Theme</p>
                <div className="flex gap-1">
                  {themeOptions.map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      onClick={() => setTheme(value)}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 ${
                        theme === value
                          ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] border border-transparent'
                      }`}
                    >
                      <Icon size={13} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Settings link (admin only) */}
              {permissions.canAccessSettings && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    router.push('/dashboard/settings');
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.05] w-full text-left transition-colors"
                >
                  <Settings size={14} />
                  Settings
                  <ChevronRight size={12} className="ml-auto text-slate-600" />
                </button>
              )}

              {/* Sign Out */}
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 w-full text-left transition-colors"
              >
                <LogOut size={14} /> Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}