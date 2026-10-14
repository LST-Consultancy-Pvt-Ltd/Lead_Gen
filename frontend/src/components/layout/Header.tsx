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
  BellOff,
  CheckCheck,
  Clock,
  UserPlus,
  ArrowRightLeft,
  Trophy,
  AlertTriangle,
  ChevronDown,
  Sparkles,
  Upload,
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
import { ThemeMenuButton } from "../../components/common/ThemePicker";

// Presentation only: icon + colour for a notification, inferred from its title/type
function notificationStyle(n: any): { icon: any; chip: string } {
  const text = `${n?.type ?? ''} ${n?.title ?? ''}`.toLowerCase();
  if (text.includes('reassign')) return { icon: ArrowRightLeft, chip: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' };
  if (text.includes('assign')) return { icon: UserPlus, chip: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' };
  if (text.includes('import')) return { icon: Upload, chip: 'bg-teal-500/10 text-teal-600 dark:text-teal-400' };
  if (text.includes('created')) return { icon: Sparkles, chip: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400' };
  if (text.includes('won') || text.includes('closed')) return { icon: Trophy, chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' };
  if (text.includes('overdue') || text.includes('follow')) return { icon: Clock, chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' };
  if (text.includes('fail') || text.includes('error') || text.includes('lost')) return { icon: AlertTriangle, chip: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' };
  return { icon: Bell, chip: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' };
}

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

      // Open what the notification is about
      if (notification.leadId) {
        router.push(`/dashboard/leads/${notification.leadId}`);
      } else if (notification.entityType === 'Opportunity' && notification.entityId) {
        router.push(`/dashboard/opportunities?focus=${notification.entityId}`);
      } else if (notification.entityType === 'Lead') {
        // e.g. "Leads Bulk Assigned" — several leads, so open the Leads list
        router.push('/dashboard/leads');
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

  // Display only: capitalise each word of the name (e.g. "sachin" → "Sachin")
  const displayName = (user?.name || '').replace(/\b\w/g, (c: string) => c.toUpperCase());

  return (
    <header className="relative z-30 h-16 flex-shrink-0 bg-white/80 dark:bg-chrome/80 backdrop-blur-xl border-b border-slate-200/80 dark:border-white/[0.06] flex items-center justify-between px-5 gap-3">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="btn-ghost w-10 h-10 p-0 justify-center"
          title="Toggle sidebar"
        >
          <Menu size={16} />
        </button>
        <div className="relative hidden sm:block" ref={searchContainerRef}>
          <Search
            size={14}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10"
          />
          <input
            className="input pl-9 pr-8 h-10 w-72 lg:w-80 text-sm bg-slate-50 dark:bg-white/[0.03]"
            placeholder="Search leads, companies…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200 dark:hover:text-white dark:hover:bg-white/10 transition-colors"
              onClick={() => setSearchQuery("")}
              title="Clear search"
            >
              <X size={13} />
            </button>
          )}

          {showDropdown && (
            <div className="absolute top-full left-0 mt-2 w-[26rem] bg-white dark:bg-surface border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl shadow-slate-900/10 dark:shadow-black/50 z-50 overflow-hidden animate-fade-in">
              {isLoading && !hasResults ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner size={18} />
                </div>
              ) : !hasResults ? (
                <div className="px-4 py-10 text-center text-sm text-slate-500">
                  No results for &ldquo;{searchQuery.trim()}&rdquo;
                </div>
              ) : (
                <div className="max-h-[440px] overflow-y-auto p-1.5 divide-y divide-slate-100 dark:divide-white/[0.05]">
                  {leads.length > 0 && (
                    <section>
                      <p className="px-2.5 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 flex items-center gap-1.5">
                        <Users size={10} /> Leads
                      </p>
                      {leads.map((item: any) => (
                        <button
                          key={item.id}
                          className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/[0.05] flex items-center gap-3 transition-colors"
                          onClick={() =>
                            navigate(`/dashboard/leads/${item.id}`)
                          }
                        >
                          <div className="w-8 h-8 rounded-lg bg-blue-500/10 ring-1 ring-blue-500/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-blue-600 dark:text-blue-300">
                            {(item.companyName ?? "?")[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                              {item.companyName}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate">
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
                      <p className="px-2.5 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 flex items-center gap-1.5">
                        <UserCircle size={10} /> Contacts
                      </p>
                      {contacts.map((item: any) => (
                        <button
                          key={item.id}
                          className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/[0.05] flex items-center gap-3 transition-colors"
                          onClick={() => navigate("/dashboard/contacts")}
                        >
                          <div className="w-8 h-8 rounded-lg bg-purple-500/10 ring-1 ring-purple-500/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-purple-600 dark:text-purple-300">
                            {(item.name ?? "?")[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                              {item.name}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate">
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
                      <p className="px-2.5 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 flex items-center gap-1.5">
                        <Building2 size={10} /> Accounts
                      </p>
                      {accounts.map((item: any) => (
                        <button
                          key={item.id}
                          className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/[0.05] flex items-center gap-3 transition-colors"
                          onClick={() => navigate("/dashboard/accounts")}
                        >
                          <div className="w-8 h-8 rounded-lg bg-amber-500/10 ring-1 ring-amber-500/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-amber-600 dark:text-amber-300">
                            {(item.companyName ?? "?")[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                              {item.companyName}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate">
                              {item.industry ?? item.website ?? ""}
                            </p>
                          </div>
                        </button>
                      ))}
                    </section>
                  )}

                  {opps.length > 0 && (
                    <section>
                      <p className="px-2.5 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 flex items-center gap-1.5">
                        <DollarSign size={10} /> Opportunities
                      </p>
                      {opps.map((item: any) => (
                        <button
                          key={item.id}
                          className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/[0.05] flex items-center gap-3 transition-colors"
                          onClick={() => navigate("/dashboard/opportunities")}
                        >
                          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-emerald-600 dark:text-emerald-300">
                            {(item.opportunityName ??
                              item.title ??
                              "?")[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                              {item.opportunityName ?? item.title}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate">
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
        {/* Theme menu */}
        <ThemeMenuButton />

        {/* Notifications */}
        <div className="relative" ref={notificationsRef}>
          <button
            className="btn-ghost w-10 h-10 p-0 justify-center relative"
            onClick={() => setNotificationsOpen((v) => !v)}
          >
            <Bell size={16} />
            {unread.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-gradient-to-br from-rose-500 to-red-600 text-[10px] text-white font-bold flex items-center justify-center ring-2 ring-chrome shadow-sm shadow-rose-500/40">
                {unread.length > 99 ? "99+" : unread.length}
              </span>
            )}
          </button>
          {notificationsOpen && (
            <div className="absolute right-0 top-full mt-2 w-[400px] max-w-[calc(100vw-32px)] card !rounded-2xl shadow-2xl shadow-slate-900/15 dark:shadow-black/50 z-50 overflow-hidden animate-fade-in">
              {/* Header */}
              <div className="relative px-4 py-3.5 border-b border-line flex items-center gap-3 bg-gradient-to-r from-blue-500/[0.07] to-transparent">
                <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/30 flex items-center justify-center flex-shrink-0">
                  <Bell size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-display text-[15px] font-semibold text-ink leading-tight">Notifications</p>
                  <p className="text-[11px] text-ink-3 mt-0.5">
                    {unread.length > 0 ? `You have ${unread.length} unread` : "You're all caught up"}
                  </p>
                </div>
                {unread.length > 0 && (
                  <span className="text-[11px] font-bold px-2 py-1 rounded-lg bg-blue-600 text-white tabular-nums">
                    {unread.length} new
                  </span>
                )}
              </div>

              <div className="max-h-[420px] overflow-y-auto px-1.5 divide-y divide-line">
                {notifications.map((n: any) => {
                  const st = notificationStyle(n);
                  const Icon = st.icon;
                  return (
                    <button
                      key={n.id}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleNotificationClick(n);
                      }}
                      type="button"
                      className={`group relative w-full flex items-start gap-3 text-left px-2.5 py-2.5 transition-colors duration-200 cursor-pointer ${
                        !n.isRead
                          ? 'bg-blue-500/[0.06] hover:bg-blue-500/[0.1]'
                          : 'bg-transparent hover:bg-sunken'
                      }`}
                    >
                      <span className={`relative w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${st.chip}`}>
                        <Icon size={17} />
                        {!n.isRead && (
                          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-blue-500 ring-2 ring-surface" />
                        )}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-start justify-between gap-2">
                          <span className={`text-[13px] font-semibold leading-snug ${!n.isRead ? 'text-ink' : 'text-ink-2'}`}>
                            {n.title}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-ink-3 whitespace-nowrap mt-0.5">
                            <Clock size={10} /> {n.createdAt ? timeAgo(n.createdAt) : "Just now"}
                          </span>
                        </span>
                        <span className={`block text-xs mt-0.5 leading-snug ${!n.isRead ? 'text-ink-2' : 'text-ink-3'}`}>
                          {n.message}
                        </span>
                        {(n.leadId || n.entityType === 'Opportunity' || n.entityType === 'Lead') && (
                          <span className="inline-flex items-center gap-0.5 mt-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">
                            {n.leadId ? 'Open lead' : n.entityType === 'Opportunity' ? 'Open deal' : 'Open leads'} <ChevronRight size={12} />
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
                {notifications.length === 0 && (
                  <div className="px-4 py-12 flex flex-col items-center text-center gap-3">
                    <span className="w-12 h-12 rounded-2xl bg-sunken text-ink-3 flex items-center justify-center">
                      <BellOff size={20} />
                    </span>
                    <p className="text-sm font-semibold text-ink">No notifications</p>
                    <p className="text-xs text-ink-3 -mt-2">New assignments and updates will show up here.</p>
                  </div>
                )}
              </div>
              <div className="p-2.5 border-t border-line bg-sunken/60">
                <button
                  type="button"
                  className="btn-ghost w-full justify-center text-xs font-semibold py-2.5"
                  disabled={!unread.length || markReadMutation.isPending}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    markReadMutation.mutate(unread.map((n: any) => n.id));
                  }}
                >
                  <CheckCheck size={14} />
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
            className={`group relative flex items-center gap-2.5 h-10 pl-1 pr-2.5 rounded-xl border bg-white dark:bg-white/[0.03] text-left hover:border-blue-400/50 hover:shadow-md hover:shadow-blue-500/10 transition-all duration-200 ${menuOpen ? 'border-blue-400/60 shadow-md shadow-blue-500/10' : 'border-slate-200 dark:border-white/[0.08]'}`}
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-md shadow-blue-500/30 ">
              {user?.name ? user.name.split(' ').filter(Boolean).map((n: string) => n[0].toUpperCase()).slice(0, 2).join('') : 'U'}
            </div>
            <div className="hidden sm:flex flex-col items-start justify-center gap-1 min-w-0 max-w-[130px] text-left">
              <span className="block w-full text-[13px] font-semibold text-slate-800 dark:text-slate-100 leading-none tracking-tight truncate text-left">
                {displayName}
              </span>
              <span className={`text-[10px] font-bold leading-none px-1.5 py-[3px] rounded ${
                user?.role === 'org_admin' || user?.role === 'super_admin'
                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : user?.role === 'manager'
                  ? 'bg-purple-500/10 text-purple-700 dark:text-purple-400'
                  : 'bg-teal-500/10 text-teal-600 dark:text-teal-400'
              }`}>
                {getRoleLabel(user?.role || '')}
              </span>
            </div>
            <ChevronDown size={14} className={`hidden sm:block flex-shrink-0 text-slate-400 transition-transform duration-200 ${menuOpen ? 'rotate-180 text-blue-500' : ''}`} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-64 card !rounded-2xl shadow-2xl shadow-slate-900/10 dark:shadow-black/50 p-1.5 z-50 animate-fade-in">
              {/* User info + role */}
              <div className="px-3 py-3 mb-1 rounded-xl bg-gradient-to-br from-blue-500/[0.08] to-indigo-500/[0.04] border border-blue-500/10">
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{displayName}</p>
                <p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
              </div>

              {/* Sign Out */}
              <button
                onClick={handleLogout}
                className="mt-1 flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 w-full text-left transition-colors"
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