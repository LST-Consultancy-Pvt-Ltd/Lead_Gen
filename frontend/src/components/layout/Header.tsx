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
import { ThemeToggle } from "../../components/common/ThemeToggle";

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

  console.log("Notifications:", notifications);
  console.log("Unread count:", unread.length);

  const markReadMutation = useMutation({
    mutationFn: (ids: string[]) => notificationsApi.markRead(ids),
    onMutate: async (ids) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["notifications"] });

      // Snapshot previous value
      const previousNotifications = queryClient.getQueryData(["notifications"]);

      // Optimistically remove notifications from list
      queryClient.setQueryData(["notifications"], (old: any) => {
        if (Array.isArray(old)) {
          return old.filter((n: any) => !ids.includes(n.id));
        }
        if (old?.items) {
          return {
            ...old,
            items: old.items.filter((n: any) => !ids.includes(n.id)),
          };
        }
        return old;
      });

      return { previousNotifications };
    },
    onSuccess: () => {
      toast.success("Notifications marked as read");
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (err, variables, context: any) => {
      // Rollback on error
      if (context?.previousNotifications) {
        queryClient.setQueryData(["notifications"], context.previousNotifications);
      }
      toast.error("Failed to mark notifications as read");
    },
  });

  // Handle individual notification click
  const handleNotificationClick = async (notification: any) => {
    console.log("Notification clicked:", notification);
    
    // Prevent event bubbling
    try {
      // Optimistically remove notification from UI immediately
      queryClient.setQueryData(["notifications"], (old: any) => {
        if (Array.isArray(old)) {
          return old.filter((n: any) => n.id !== notification.id);
        }
        if (old?.items) {
          return {
            ...old,
            items: old.items.filter((n: any) => n.id !== notification.id),
          };
        }
        return old;
      });

      // Close dropdown
      setNotificationsOpen(false);

      // Mark as read in background (don't wait for it)
      notificationsApi.markRead([notification.id])
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["notifications"] });
        })
        .catch((error) => {
          console.error("Failed to mark notification as read:", error);
          toast.error("Failed to mark notification as read");
          queryClient.invalidateQueries({ queryKey: ["notifications"] });
        });

      // Redirect to lead details if leadId exists
      if (notification.leadId) {
        console.log("Navigating to lead:", notification.leadId);
        router.push(`/dashboard/leads/${notification.leadId}`);
      } else {
        console.log("No leadId in notification:", notification);
      }
    } catch (error) {
      console.error("Error in handleNotificationClick:", error);
    }
  };

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
    <header className="h-14 flex-shrink-0 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-white/[0.06] flex items-center justify-between px-4 gap-3">
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
            <div className="absolute top-full left-0 mt-1.5 w-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl shadow-black/10 dark:shadow-black/50 z-50 overflow-hidden">
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
                          className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800/60 flex items-center gap-3 transition-colors"
                          onClick={() =>
                            navigate(`/dashboard/leads/${item.id}`)
                          }
                        >
                          <div className="w-7 h-7 rounded-lg bg-blue-500/15 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-blue-400">
                            {(item.companyName ?? "?")[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
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
                          className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800/60 flex items-center gap-3 transition-colors"
                          onClick={() => navigate("/dashboard/contacts")}
                        >
                          <div className="w-7 h-7 rounded-lg bg-purple-500/15 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-purple-400">
                            {(item.name ?? "?")[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
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
                          className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800/60 flex items-center gap-3 transition-colors"
                          onClick={() => navigate("/dashboard/accounts")}
                        >
                          <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-amber-400">
                            {(item.companyName ?? "?")[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
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
                          className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800/60 flex items-center gap-3 transition-colors"
                          onClick={() => navigate("/dashboard/opportunities")}
                        >
                          <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-emerald-400">
                            {(item.opportunityName ??
                              item.title ??
                              "?")[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
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
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#EF4444] text-[10px] text-white font-semibold flex items-center justify-center border border-white dark:border-slate-950">
                {unread.length > 99 ? "99+" : unread.length}
              </span>
            )}
          </button>
          {notificationsOpen && (
            <div className="absolute right-0 top-full mt-1 w-80 card shadow-xl shadow-black/10 dark:shadow-black/40 z-50 overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-200 dark:border-white/[0.06]">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Notifications
                </p>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.slice(0, 10).map((n: any) => (
                  <button
                    key={n.id}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleNotificationClick(n);
                    }}
                    type="button"
                    className={`
                      w-full text-left px-3 py-2 border-b border-slate-100 dark:border-white/[0.04]
                      transition-all duration-200 cursor-pointer
                      ${!n.isRead 
                        ? 'bg-[#E8F0FE] dark:bg-[#1E3A5F] border-l-4 border-l-[#2563EB] hover:bg-[#D1E3FC] dark:hover:bg-[#2A4A70]' 
                        : 'bg-white dark:bg-slate-900 hover:bg-[#F3F4F6] dark:hover:bg-slate-800/60'
                      }
                    `}
                  >
                    <p className={`text-sm font-semibold ${!n.isRead ? 'text-[#1A1A1A] dark:text-slate-100' : 'text-[#6B7280] dark:text-slate-400'}`}>
                      {n.title}
                    </p>
                    <p className={`text-xs mt-0.5 ${!n.isRead ? 'text-[#1A1A1A] dark:text-slate-300' : 'text-[#6B7280] dark:text-slate-500'}`}>
                      {n.message}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-600 mt-1">
                      {n.createdAt ? timeAgo(n.createdAt) : "Just now"}
                    </p>
                  </button>
                ))}
                {notifications.length === 0 && (
                  <div className="px-3 py-8 text-center text-xs text-slate-500">
                    No notifications
                  </div>
                )}
              </div>
              <div className="p-2 border-t border-slate-200 dark:border-white/[0.06]">
                <button
                  type="button"
                  className="btn-ghost w-full justify-center text-xs"
                  disabled={!unread.length || markReadMutation.isPending}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log("Mark all read clicked, unread:", unread);
                    markReadMutation.mutate(unread.map((n: any) => n.id));
                  }}
                >
                  {markReadMutation.isPending ? "Marking..." : "Mark All Read"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Profile Menu */}
        <div className="relative" ref={profileMenuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="group relative flex items-center gap-2.5 pl-1.5 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 hover:border-blue-400/50 hover:shadow-md hover:shadow-blue-500/10 transition-all duration-200"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-sm shadow-blue-500/30">
              {user?.name ? user.name.split(' ').filter(Boolean).map((n: string) => n[0].toUpperCase()).slice(0, 2).join('') : 'U'}
            </div>
            <div className="hidden sm:flex flex-col items-start gap-0.5 w-[90px]">
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-none tracking-tight w-full truncate">
                {user?.name && user.name.length > 10 ? user.name.slice(0, 10) + '…' : user?.name}
              </span>
              <span className={`text-[10px] font-bold leading-none px-1.5 py-0.5 rounded-md ${
                user?.role === 'org_admin' || user?.role === 'super_admin'
                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : user?.role === 'manager'
                  ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                  : 'bg-teal-500/10 text-teal-600 dark:text-teal-400'
              }`}>
                {getRoleLabel(user?.role || '')}
              </span>
            </div>
            {/* Hover tooltip */}
            <div className="absolute right-0 top-[calc(100%+8px)] z-[60] hidden group-hover:flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl shadow-xl shadow-black/10 dark:shadow-black/40 px-4 py-3 min-w-[180px] pointer-events-none">
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">{user?.name}</span>
              <span className="text-xs text-slate-500 mt-1">{getRoleLabel(user?.role || '')}</span>
            </div>
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