"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activitiesApi,
  leadsApi,
  opportunitiesApi,
  usersApi,
} from "../../../lib/api";
import { Avatar, Spinner, EmptyState } from "../../../components/ui";
import { getInitials, timeAgo } from "../../../lib/utils";
import { usePermissions, useUserRole } from "../../../lib/rbac";
import { useAuthStore } from "../../../store/authStore";
import {
  CheckSquare,
  Phone,
  MessageSquare,
  Mail,
  Calendar,
  Search,
  Plus,
  X,
  Video,
  RefreshCw,
  User,
  List,
  Clock,
  ChevronDown,
  Trash2,
  AlertTriangle,
  Info,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import toast from "react-hot-toast";

// == Types ==
type ActivityFormData = {
  type: string;
  activityDate: string;
  duration: string;
  linkedToType: "lead" | "opportunity";
  leadId: string;
  opportunityId: string;
  outcome: string;
  nextActionDate: string;
  notes: string;
  description: string;
};

const defaultValues: ActivityFormData = {
  type: "call",
  activityDate: "",
  duration: "",
  linkedToType: "lead",
  leadId: "",
  opportunityId: "",
  description: "",
  outcome: "",
  nextActionDate: "",
  notes: "",
};

const activitySchema = yup.object({
  type: yup.string().required("Activity type is required"),
  activityDate: yup
    .string()
    .required("Activity date is required")
    .test(
      "not-future",
      "Activity date cannot be a future date",
      (value) => !value || new Date(value) <= new Date(),
    ),
  duration: yup.string().default(""),
  linkedToType: yup.string().oneOf(["lead", "opportunity"]).required(),
  leadId: yup.string().default(""),
  opportunityId: yup.string().default(""),
  outcome: yup.string().required("Outcome is required"),
  nextActionDate: yup
    .string()
    .required("Next action date is required")
    .test(
      "today-or-future",
      "Next action date must be today or a future date",
      (value) => {
        if (!value) return true;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return new Date(value) >= today;
      },
    ),
  notes: yup.string().default(""),
  description: yup.string().default(""),
});

// == Icon/color map ==
const ICON_MAP: Record<
  string,
  { icon: any; color: string; bg: string; text: string }
> = {
  call: {
    icon: Phone,
    color: "blue",
    bg: "bg-blue-500/15",
    text: "text-blue-400",
  },
  email: {
    icon: Mail,
    color: "blue",
    bg: "bg-blue-500/15",
    text: "text-blue-400",
  },
  meeting: {
    icon: Calendar,
    color: "purple",
    bg: "bg-purple-500/15",
    text: "text-purple-400",
  },
  demo: {
    icon: Video,
    color: "green",
    bg: "bg-green-500/15",
    text: "text-green-400",
  },
  follow_up: {
    icon: RefreshCw,
    color: "amber",
    bg: "bg-amber-500/15",
    text: "text-amber-400",
  },
  whatsapp: {
    icon: MessageSquare,
    color: "green",
    bg: "bg-green-500/15",
    text: "text-green-400",
  },
  note: {
    icon: MessageSquare,
    color: "gray",
    bg: "bg-slate-500/15",
    text: "text-slate-400",
  },
};
const DEFAULT_META = {
  icon: CheckSquare,
  color: "gray",
  bg: "bg-slate-500/15",
  text: "text-slate-400",
};

const ACTIVITY_TYPES = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "demo", label: "Demo" },
  { value: "follow_up", label: "Follow Up" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "note", label: "Note" },
];

// == Helpers ==
function getTypeMeta(type: string) {
  const safeType = type ?? "note";
  const meta = ICON_MAP[safeType] ?? DEFAULT_META;
  const match = ACTIVITY_TYPES.find((t) => t.value === safeType);
  return {
    ...meta,
    label:
      match?.label ??
      safeType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    value: safeType,
  };
}

function isToday(dateStr: string) {
  if (!dateStr) return false;
  const d = new Date(dateStr),
    n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

function isThisWeek(dateStr: string) {
  if (!dateStr) return false;
  const d = new Date(dateStr),
    n = new Date();
  const start = new Date(n);
  start.setDate(n.getDate() - n.getDay());
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return d >= start && d < end;
}

function isPastDate(dateStr: string) {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dateStr + "T00:00:00") < today;
}

function formatActivityDate(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const n = new Date();
  const yesterday = new Date(n);
  yesterday.setDate(n.getDate() - 1);
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  if (isToday(dateStr)) return "Today, " + time;
  if (d.toDateString() === yesterday.toDateString())
    return "Yesterday, " + time;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDate(dateStr: string) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function daysSince(dateStr: string) {
  if (!dateStr) return 0;
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - d.getTime()) / 86_400_000);
}

function getNextActionDisplay(
  dateStr: string,
): { label: string; color: string } | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  if (d.toDateString() === today.toDateString())
    return { label: formatDate(dateStr) + " (due)", color: "text-amber-400" };
  if (d < today)
    return {
      label:
        formatDate(dateStr) + " \u2014 " + daysSince(dateStr) + " days overdue",
      color: "text-red-400",
    };
  return { label: formatDate(dateStr), color: "text-blue-400" };
}

function groupActivitiesByDate(activities: any[]) {
  const groups: Record<string, any[]> = {};
  activities.forEach((a) => {
    const raw = a.activityDate || a.createdAt;
    const d = new Date(raw);
    const n = new Date();
    const yesterday = new Date(n);
    yesterday.setDate(n.getDate() - 1);
    let key: string;
    if (isToday(raw)) key = "Today";
    else if (d.toDateString() === yesterday.toDateString()) key = "Yesterday";
    else
      key = d.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    if (!groups[key]) groups[key] = [];
    groups[key].push(a);
  });
  return groups;
}

// == Activity Row ==
function ActivityRow({
  activity,
  showLoggedBy,
  canDelete,
  onDelete,
}: {
  activity: any;
  showLoggedBy: boolean;
  canDelete: boolean;
  onDelete?: (activity: any) => void;
}) {
  const meta = getTypeMeta(activity.type);
  const Icon = meta.icon;
  const nextAction = activity.nextActionDate
    ? getNextActionDisplay(activity.nextActionDate)
    : null;
  const isOverdue =
    activity.nextActionDate && isPastDate(activity.nextActionDate);
  const linkedName =
    activity.lead?.companyName ?? activity.opportunity?.opportunityName ?? null;
  const linkedType = activity.leadId
    ? "lead"
    : activity.opportunityId
      ? "opportunity"
      : null;
  const linkedHref = activity.leadId
    ? "/dashboard/leads/" + activity.leadId
    : "/dashboard/opportunities";

  return (
    <div className="px-5 py-4 hover:bg-slate-200/30 dark:hover:bg-slate-800/30 transition-colors">
      <div className="flex items-start gap-3">
        <div
          className={
            "w-8 h-8 rounded-xl " +
            meta.bg +
            " flex items-center justify-center flex-shrink-0 mt-0.5"
          }
        >
          <Icon size={15} className={meta.text} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span className={"text-xs font-semibold " + meta.text}>
                {meta.label}
              </span>
              {linkedName && (
                <>
                  <span className="text-xs text-slate-600">linked to</span>
                  <a
                    href={linkedHref}
                    className="text-xs text-blue-400 hover:text-blue-300 font-medium truncate max-w-[180px]"
                  >
                    {linkedName}
                  </a>
                  {linkedType && (
                    <span
                      className={
                        "text-[10px] px-1.5 py-0.5 rounded-full font-semibold " +
                        (linkedType === "lead"
                          ? "bg-blue-500/15 text-blue-400"
                          : "bg-purple-500/15 text-purple-400")
                      }
                    >
                      {linkedType === "lead" ? "Lead" : "Opportunity"}
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isOverdue && (
                <span className="text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-500/25 px-1.5 py-0.5 rounded-full">
                  Overdue
                </span>
              )}
              <span className="text-xs text-slate-500 whitespace-nowrap">
                {activity.activityDate
                  ? formatActivityDate(activity.activityDate)
                  : timeAgo(activity.createdAt)}
                {activity.duration
                  ? " \u00B7 " + activity.duration + " mins"
                  : ""}
              </span>
            </div>
          </div>
          {activity.outcome && (
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 line-clamp-2">
              &ldquo;{activity.outcome}&rdquo;
            </p>
          )}
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {nextAction && (
              <span className={"text-[11px] " + nextAction.color}>
                Next action: {nextAction.label}
              </span>
            )}
            {showLoggedBy && activity.createdBy?.name && (
              <span className="inline-flex items-center gap-1 text-[11px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full">
                <User size={10} /> {activity.createdBy.name}
              </span>
            )}
            {canDelete && onDelete && (
              <button
                onClick={() => onDelete(activity)}
                className="inline-flex items-center gap-1 text-[11px] bg-red-500/10 text-red-400 hover:bg-red-500/20 px-2 py-0.5 rounded-full transition-colors"
              >
                <X size={10} /> Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// == Delete Modal ==
function DeleteModal({
  activity,
  isPending,
  onConfirm,
  onCancel,
}: {
  activity: any;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const meta = getTypeMeta(activity.type);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={20} className="text-red-400" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Delete this activity?
          </h3>
        </div>
        <p className="text-sm text-slate-400 leading-relaxed">
          {/* You are about to delete the <span className="text-slate-800 dark:text-slate-200 font-medium">{meta.label}</span> activity
          logged by <span className="text-slate-800 dark:text-slate-200 font-medium">{activity.createdBy?.name ?? 'Unknown'}</span>
          {activity.activityDate ? ' on ' + formatDate(activity.activityDate) : ''}.
          This action is permanent and will be recorded in the Audit Log. */}
          Are you Sure want's to Delete
        </p>
        <div className="flex gap-2 pt-2">
          <button
            className="btn-ghost flex-1"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            className="flex-1 h-10 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 text-sm font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? "Deleting\u2026" : "Yes, delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// == Page ==
export default function ActivitiesPage() {
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const role = useUserRole();
  const currentUser = useAuthStore((s) => s.user);

  const isSalesUser = role === "sales_user";
  const isManager = role === "manager";
  const isAdmin = permissions.isAdmin;

  const [viewMode, setViewMode] = useState<"list" | "timeline">("list");
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [loggedByFilter, setLoggedByFilter] = useState("");
  const [linkedToFilterId, setLinkedToFilterId] = useState("");
  const [linkedToFilterName, setLinkedToFilterName] = useState("");
  const [linkedToFilterQuery, setLinkedToFilterQuery] = useState("");
  const [debouncedLTFQ, setDebouncedLTFQ] = useState("");
  const [showLinkedFilter, setShowLinkedFilter] = useState(false);
  const [page, setPage] = useState(1);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [linkedSearch, setLinkedSearch] = useState("");
  const [debouncedLS, setDebouncedLS] = useState("");
  const [linkedDropOpen, setLinkedDropOpen] = useState(false);
  const [linkedDisplay, setLinkedDisplay] = useState("");
  const linkedSearchRef = useRef<HTMLDivElement>(null);
  const linkedFilterRef = useRef<HTMLDivElement>(null);

  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [pageInput, setPageInput] = useState(String(page));

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchText), 300);
    return () => clearTimeout(t);
  }, [searchText]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedLS(linkedSearch), 300);
    return () => clearTimeout(t);
  }, [linkedSearch]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedLTFQ(linkedToFilterQuery), 300);
    return () => clearTimeout(t);
  }, [linkedToFilterQuery]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        linkedSearchRef.current &&
        !linkedSearchRef.current.contains(e.target as Node)
      )
        setLinkedDropOpen(false);
      if (
        linkedFilterRef.current &&
        !linkedFilterRef.current.contains(e.target as Node)
      )
        setShowLinkedFilter(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ActivityFormData>({
    defaultValues,
    resolver: yupResolver(activitySchema) as any,
    mode: "onBlur",
  });

  const outcome = watch("outcome") || "";

  const baseParams = permissions.canViewAllLeads ? {} : { assignedToMe: true };

  // Stats query
  const { data: statsRaw } = useQuery({
    queryKey: ["activities-stats", baseParams],
    queryFn: () =>
      activitiesApi.list({ ...baseParams, limit: 200 }).then((r) => r.data),
    staleTime: 60_000,
  });
  const allForStats = useMemo(
    () => (statsRaw?.data as any[]) ?? [],
    [statsRaw],
  );
  const stats = useMemo(
    () => ({
      today: allForStats.filter((a) => isToday(a.activityDate || a.createdAt))
        .length,
      thisWeek: allForStats.filter((a) =>
        isThisWeek(a.activityDate || a.createdAt),
      ).length,
      followUps: allForStats.filter(
        (a) => a.nextActionDate && isToday(a.nextActionDate),
      ).length,
      overdue: allForStats.filter(
        (a) => a.nextActionDate && isPastDate(a.nextActionDate),
      ).length,
      total: allForStats.length,
    }),
    [allForStats],
  );

  const overdueActivities = useMemo(
    () =>
      allForStats
        .filter((a) => a.nextActionDate && isPastDate(a.nextActionDate))
        .sort(
          (a, b) => daysSince(b.nextActionDate) - daysSince(a.nextActionDate),
        ),
    [allForStats],
  );

  // List query
  const listParams: any = { page, limit: 20, ...baseParams };
  if (debouncedSearch) listParams.search = debouncedSearch;
  if (typeFilter) listParams.type = typeFilter;
  if (loggedByFilter) listParams.createdById = loggedByFilter;
  if (linkedToFilterId) listParams.leadId = linkedToFilterId;
  if (dateFilter) {
    const now = new Date();
    if (dateFilter === "today") {
      listParams.dateFrom = now.toISOString().split("T")[0];
      listParams.dateTo = now.toISOString().split("T")[0];
    } else if (dateFilter === "week") {
      const s = new Date(now);
      s.setDate(now.getDate() - now.getDay());
      listParams.dateFrom = s.toISOString().split("T")[0];
    } else if (dateFilter === "month") {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      listParams.dateFrom = s.toISOString().split("T")[0];
    }
  }

  const { data: listData, isLoading } = useQuery({
    queryKey: ["activities", listParams],
    queryFn: () => activitiesApi.list(listParams).then((r) => r.data),
    placeholderData: (prev) => prev,
  });
  const activities = (listData?.data as any[]) ?? [];
  const pagination = listData?.pagination;
  const total = pagination?.total ?? 0;
  const totalPages = pagination?.totalPages ?? 1;
  const timelineGroups = useMemo(
    () => groupActivitiesByDate(activities),
    [activities],
  );

  // Team members
  const { data: usersRaw } = useQuery({
    queryKey: ["team-members"],
    queryFn: () => usersApi.list().then((r) => r.data?.data ?? r.data ?? []),
    enabled: permissions.canViewAllLeads,
    staleTime: 120_000,
  });
  const teamMembers = Array.isArray(usersRaw) ? usersRaw : [];

  // Linked-to search for form
  const { data: lsLeadsRaw } = useQuery({
    queryKey: ["ls-leads", debouncedLS],
    queryFn: () =>
      leadsApi
        .list({ search: debouncedLS, limit: 5, ...baseParams })
        .then((r) => r.data?.data ?? []),
    enabled: debouncedLS.length >= 1,
    staleTime: 10_000,
  });
  const { data: lsOppsRaw } = useQuery({
    queryKey: ["ls-opps", debouncedLS],
    queryFn: () =>
      opportunitiesApi
        .list({ search: debouncedLS, limit: 5, ...baseParams })
        .then((r) => r.data?.data ?? r.data ?? []),
    enabled: debouncedLS.length >= 1,
    staleTime: 10_000,
  });
  const lsLeads = Array.isArray(lsLeadsRaw) ? lsLeadsRaw : [];
  const lsOpps = Array.isArray(lsOppsRaw) ? lsOppsRaw : [];

  // Linked-to filter search (admin)
  const { data: flLeadsRaw } = useQuery({
    queryKey: ["fl-leads", debouncedLTFQ],
    queryFn: () =>
      leadsApi
        .list({ search: debouncedLTFQ, limit: 6, ...baseParams })
        .then((r) => r.data?.data ?? []),
    enabled: debouncedLTFQ.length >= 1 && showLinkedFilter && isAdmin,
    staleTime: 10_000,
  });
  const flLeads = Array.isArray(flLeadsRaw) ? flLeadsRaw : [];

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (payload: any) => activitiesApi.create(payload),
    onSuccess: () => {
      toast.success("Activity logged");
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      closeForm();
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.message || "Failed to log activity"),
  });

  // Delete mutation (admin only)
  const deleteMutation = useMutation({
    mutationFn: (id: string) => activitiesApi.delete(id),
    onSuccess: () => {
      toast.success("Activity deleted");
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      setDeleteTarget(null);
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.message || "Failed to delete activity"),
  });

  function onSubmit(values: ActivityFormData) {
    createMutation.mutate({
      type: values.type,
      description: values.outcome,
      outcome: values.outcome,
      leadId:
        values.linkedToType === "lead" ? values.leadId || undefined : undefined,
      opportunityId:
        values.linkedToType === "opportunity"
          ? values.opportunityId || undefined
          : undefined,
      activityDate: values.activityDate,
      nextActionDate: values.nextActionDate
        ? (() => {
            const today = new Date().toISOString().split("T")[0];
            return values.nextActionDate === today
              ? values.nextActionDate + "T23:59:59"
              : values.nextActionDate;
          })()
        : undefined,
      duration: values.duration ? parseInt(values.duration, 10) : undefined,
      notes: values.notes || undefined,
    });
  }

  function selectLinked(
    type: "lead" | "opportunity",
    id: string,
    name: string,
  ) {
    setValue("linkedToType", type);
    if (type === "lead") {
      setValue("leadId", id);
      setValue("opportunityId", "");
    } else {
      setValue("opportunityId", id);
      setValue("leadId", "");
    }
    setLinkedDisplay(name);
    setLinkedSearch("");
    setLinkedDropOpen(false);
  }

  function closeForm() {
    setIsCreateOpen(false);
    reset(defaultValues);
    setLinkedDisplay("");
    setLinkedSearch("");
  }

  function clearFilters() {
    setSearchText("");
    setTypeFilter("");
    setDateFilter("");
    setLoggedByFilter("");
    setLinkedToFilterId("");
    setLinkedToFilterName("");
    setLinkedToFilterQuery("");
    setPage(1);
  }

  const hasActiveFilters = !!(
    searchText ||
    typeFilter ||
    dateFilter ||
    loggedByFilter ||
    linkedToFilterId
  );
  const linkedToError = (errors as any)?.[""]?.message;

  const pageTitle = isSalesUser
    ? "Activities"
    : isManager
      ? "Team activities"
      : "All activities";
  const pageDesc = isSalesUser
    ? "Log and track every interaction with your leads and opportunities"
    : isManager
      ? "All interactions logged by your team \u2014 leads and opportunities"
      : "Organisation-wide activity log \u2014 all executives, all records";

  const statCards = useMemo(() => {
    if (isSalesUser)
      return [
        {
          label: "Today",
          value: stats.today,
          sub: "activities logged",
          color: "text-slate-900 dark:text-slate-100",
        },
        {
          label: "This week",
          value: stats.thisWeek,
          sub: "total logged",
          color: "text-slate-900 dark:text-slate-100",
        },
        {
          label: "Follow-ups due",
          value: stats.followUps,
          sub: "next action today",
          color: "text-amber-400",
        },
        {
          label: "Overdue",
          value: stats.overdue,
          sub: "past next action date",
          color: "text-red-400",
        },
      ];
    if (isManager)
      return [
        {
          label: "Team today",
          value: stats.today,
          sub: "activities logged",
          color: "text-slate-900 dark:text-slate-100",
        },
        {
          label: "This week",
          value: stats.thisWeek,
          sub: "total team activities",
          color: "text-slate-900 dark:text-slate-100",
        },
        {
          label: "Overdue (team)",
          value: stats.overdue,
          sub: "needs coaching",
          color: "text-red-400",
        },
        {
          label: "No activity 7d+",
          value: allForStats.filter((a) => {
            const d = a.activityDate || a.createdAt;
            return d && daysSince(d.split("T")[0]) >= 7;
          }).length,
          sub: "leads going cold",
          color: "text-amber-400",
        },
      ];
    return [
      {
        label: "System today",
        value: stats.today,
        sub: "org-wide activities",
        color: "text-slate-900 dark:text-slate-100",
      },
      {
        label: "This week",
        value: stats.thisWeek,
        sub: "all executives",
        color: "text-slate-900 dark:text-slate-100",
      },
      {
        label: "Overdue (all)",
        value: stats.overdue,
        sub: "system-wide",
        color: "text-red-400",
      },
      {
        label: "Total activities",
        value: stats.total,
        sub: "since go-live",
        color: "text-slate-900 dark:text-slate-100",
      },
    ];
  }, [isSalesUser, isManager, stats, allForStats]);

  return (
    <div className="space-y-5">
      {/* Role badge */}
      <div className="flex items-center gap-2">
        <span
          className={
            "text-[11px] font-semibold px-2.5 py-1 rounded-full " +
            (isSalesUser
              ? "bg-emerald-500/15 text-emerald-400"
              : isManager
                ? "bg-amber-500/15 text-amber-400"
                : "bg-blue-500/15 text-blue-400")
          }
        >
          {"\u25CF"}{" "}
          {isSalesUser
            ? "Sales Executive \u2014 own records only"
            : isManager
              ? "Sales Manager \u2014 full team visibility"
              : "Admin / CEO \u2014 system-wide access"}
        </span>
      </div>

      {/* 1. PAGE HEADER */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">{pageTitle}</h1>
          <p className="text-sm text-slate-500 mt-1">{pageDesc}</p>
        </div>
        {permissions.canLogActivity && (
          <button className="btn-primary" onClick={() => setIsCreateOpen(true)}>
            <Plus size={14} /> Log Activity
          </button>
        )}
      </div>

      {/* 2. SUMMARY STATS */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {statCards.map((s, i) => (
          <div key={i} className="card p-4">
            <p className="text-xs text-slate-500 mb-1">{s.label}</p>
            <p className={"text-2xl font-bold " + s.color}>{s.value}</p>
            <p className="text-xs text-slate-600 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Manager info */}
      {/* {isManager && (
        <div className="flex items-start gap-2 bg-blue-500/5 border border-blue-500/15 rounded-xl px-4 py-3">
          <Info size={14} className="text-blue-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-blue-300/80">
            Manager view: you can log activities on any team record.
            &ldquo;Logged By&rdquo; column shows which executive created each
            entry.
          </p>
        </div>
      )} */}

      {/* Admin info */}
      {/* {isAdmin && (
        <div className="flex items-start gap-2 bg-blue-500/5 border border-blue-500/15 rounded-xl px-4 py-3">
          <Info size={14} className="text-blue-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-blue-300/80">
            Admin view: you can log activities on any record and delete
            activities (with confirmation). All changes are logged in the Audit
            Log.
          </p>
        </div>
      )} */}

      {/* 3. VIEW TOGGLE */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setViewMode("list")}
          className={
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors " +
            (viewMode === "list"
              ? "bg-slate-200 dark:bg-slate-800 border-white/20 text-slate-900 dark:text-slate-100"
              : "bg-transparent border-slate-200 dark:border-white/10 text-slate-500 hover:border-slate-400 dark:hover:border-white/20")
          }
        >
          <List size={13} /> List view
        </button>
        <button
          onClick={() => setViewMode("timeline")}
          className={
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors " +
            (viewMode === "timeline"
              ? "bg-slate-200 dark:bg-slate-800 border-white/20 text-slate-900 dark:text-slate-100"
              : "bg-transparent border-slate-200 dark:border-white/10 text-slate-500 hover:border-slate-400 dark:hover:border-white/20")
          }
        >
          <Clock size={13} /> Timeline view
        </button>
      </div>

      {/* 4. FILTERS */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          {/* <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
            />
            <input
              className="input pl-8 h-9 text-xs w-full"
              placeholder="Search outcome, notes, lead name\u2026"
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value);
                setPage(1);
              }}
            />
          </div> */}

          {/* Exec filter \u2014 manager and admin */}
          {!isSalesUser && teamMembers.length > 0 && (
            <select
              className="input h-9 text-xs"
              title="Filter by executive"
              value={loggedByFilter}
              onChange={(e) => {
                setLoggedByFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All executives</option>
              {teamMembers.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}

          {/* Type filter \u2014 manager and admin dropdown */}
          {!isSalesUser && (
            <select
              className="input h-9 text-xs"
              title="Filter by type"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All types</option>
              {ACTIVITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          )}

          {/* Date range \u2014 manager and admin */}
          {!isSalesUser && (
            <select
              className="input h-9 text-xs"
              title="Date range"
              value={dateFilter}
              onChange={(e) => {
                setDateFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All time</option>
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
            </select>
          )}

          {/* Linked-to filter \u2014 admin only */}
          {isAdmin && (
            <div className="relative" ref={linkedFilterRef}>
              <button
                className={
                  "flex items-center gap-1.5 input h-9 text-xs cursor-pointer min-w-[140px] " +
                  (linkedToFilterId ? "text-blue-300" : "")
                }
                onClick={() => setShowLinkedFilter((v) => !v)}
              >
                <span className="truncate max-w-[120px]">
                  {linkedToFilterName || "Leads & opportunities"}
                </span>
                {linkedToFilterId ? (
                  <X
                    size={11}
                    className="text-slate-400 hover:text-red-400 ml-auto flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLinkedToFilterId("");
                      setLinkedToFilterName("");
                      setLinkedToFilterQuery("");
                      setPage(1);
                    }}
                  />
                ) : (
                  <ChevronDown size={11} className="ml-auto flex-shrink-0" />
                )}
              </button>
              {showLinkedFilter && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl shadow-xl z-40 p-2">
                  <input
                    autoFocus
                    className="input h-8 text-xs w-full"
                    placeholder="Search lead\u2026"
                    value={linkedToFilterQuery}
                    onChange={(e) => setLinkedToFilterQuery(e.target.value)}
                  />
                  <div className="mt-1 max-h-40 overflow-y-auto">
                    {flLeads.map((l: any) => (
                      <button
                        key={l.id}
                        className="w-full text-left px-2 py-1.5 text-xs hover:bg-slate-200 dark:hover:bg-slate-800 rounded text-slate-600 dark:text-slate-300"
                        onClick={() => {
                          setLinkedToFilterId(l.id);
                          setLinkedToFilterName(l.companyName);
                          setShowLinkedFilter(false);
                          setPage(1);
                        }}
                      >
                        {l.companyName}
                      </button>
                    ))}
                    {linkedToFilterQuery.length >= 1 &&
                      flLeads.length === 0 && (
                        <p className="text-xs text-slate-600 px-2 py-2">
                          No leads found
                        </p>
                      )}
                  </div>
                </div>
              )}
            </div>
          )}

          {hasActiveFilters && (
            <button
              className="text-xs text-slate-500 hover:text-slate-500 dark:hover:text-slate-300 flex items-center gap-1"
              onClick={clearFilters}
            >
              <X size={11} /> Clear all
            </button>
          )}
        </div>

        {/* Type pills \u2014 sales user only */}
        {isSalesUser && (
          <div className="flex flex-wrap gap-1.5">
            {[{ value: "", label: "All types" }, ...ACTIVITY_TYPES].map((t) => (
              <button
                key={t.value}
                onClick={() => {
                  setTypeFilter(t.value);
                  setPage(1);
                }}
                className={
                  "px-3 py-1 rounded-full text-xs border transition-colors " +
                  (typeFilter === t.value
                    ? "bg-blue-500/15 border-blue-500/40 text-blue-300"
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 text-slate-400 hover:border-slate-400 dark:hover:border-white/20")
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 5. ACTIVITY LIST */}
      <div className="card overflow-hidden">
        {!isSalesUser && activities.length > 0 && (
          <div className="px-5 py-3 border-b border-slate-200 dark:border-white/[0.04]">
            <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-widest">
              {isManager ? "All team activities" : "System-wide activity log"}
            </p>
          </div>
        )}
        {isSalesUser && activities.length > 0 && (
          <div className="px-5 py-3 border-b border-slate-200 dark:border-white/[0.04]">
            <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-widest">
              Recent activities
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Spinner size={24} />
          </div>
        ) : activities.length === 0 ? (
          hasActiveFilters ? (
            <EmptyState
              icon={Search}
              title="No results found"
              description="Try changing your filters or search terms"
              action={
                <button className="btn-ghost text-xs" onClick={clearFilters}>
                  Clear filters
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={CheckSquare}
              title="No activities yet"
              description="Start by logging your first activity with a lead or opportunity"
              action={
                permissions.canLogActivity ? (
                  <button
                    className="btn-primary text-xs"
                    onClick={() => setIsCreateOpen(true)}
                  >
                    <Plus size={13} /> Log Activity
                  </button>
                ) : undefined
              }
            />
          )
        ) : viewMode === "list" ? (
          <div className="divide-y divide-white/[0.04]">
            {activities.map((a) => (
              <ActivityRow
                key={a.id}
                activity={a}
                showLoggedBy={!isSalesUser}
                canDelete={isAdmin}
                onDelete={isAdmin ? setDeleteTarget : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="p-5 space-y-6">
            {Object.entries(timelineGroups).map(([label, items]) => (
              <div key={label}>
                <div className="flex items-center gap-3 mb-3">
                  <p className="text-xs font-semibold text-slate-400 whitespace-nowrap">
                    {label}
                  </p>
                  <div className="flex-1 h-px bg-white/[0.04]" />
                  <span className="text-[10px] text-slate-600">
                    {items.length} activit{items.length === 1 ? "y" : "ies"}
                  </span>
                </div>
                <div className="space-y-1 pl-2 border-l border-slate-200 dark:border-white/[0.06]">
                  {items.map((a) => (
                    <ActivityRow
                      key={a.id}
                      activity={a}
                      showLoggedBy={!isSalesUser}
                      canDelete={isAdmin}
                      onDelete={isAdmin ? setDeleteTarget : undefined}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* PAGINATION */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            {total} total activities
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="w-8 h-8 rounded-lg flex items-center justify-center border border-slate-200 dark:border-white/10 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Previous page"
            >
              <ChevronLeft size={14} />
            </button>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <input
                type="text"
                inputMode="numeric"
                value={pageInput}
                onChange={(e) =>
                  setPageInput(e.target.value.replace(/[^0-9]/g, ""))
                }
                onBlur={() => {
                  const v = parseInt(pageInput, 10);
                  if (isNaN(v) || v < 1) {
                    setPage(1);
                    setPageInput("1");
                  } else if (v > totalPages) {
                    setPage(totalPages);
                    setPageInput(String(totalPages));
                  } else setPage(v);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                onFocus={(e) => e.currentTarget.select()}
                className="w-10 h-8 rounded-lg bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-white/10 text-center text-xs text-slate-800 dark:text-slate-200 font-medium focus:border-blue-500/50 focus:outline-none cursor-text"
                title="Go to page"
              />
              <span>/ {totalPages}</span>
            </div>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="w-8 h-8 rounded-lg flex items-center justify-center border border-slate-200 dark:border-white/10 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next page"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* COACHING ALERTS \u2014 manager only */}
      {isManager && overdueActivities.length > 0 && (
        <div className="card overflow-hidden border-amber-500/20">
          <div className="px-5 py-3 border-b border-slate-200 dark:border-white/[0.04] bg-amber-500/5">
            <p className="text-xs font-semibold text-amber-400">
              Coaching alerts \u2014 overdue follow-ups across team
            </p>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {overdueActivities.slice(0, 8).map((a) => {
              const linkedName =
                a.lead?.companyName ??
                a.opportunity?.opportunityName ??
                "Unknown";
              const days = daysSince(a.nextActionDate);
              return (
                <div
                  key={a.id}
                  className="px-5 py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800 dark:text-slate-200 font-medium truncate">
                      {a.createdBy?.name ?? "Unknown"} {"\u2014"} {linkedName}
                      {a.opportunity?.opportunityName ? " Opp" : ""}
                    </p>
                    <p className="text-xs text-slate-500">
                      {a.createdBy?.name ?? "Unknown"}
                    </p>
                  </div>
                  <span
                    className={
                      "text-xs font-semibold flex-shrink-0 " +
                      (days >= 7 ? "text-red-400" : "text-amber-400")
                    }
                  >
                    {days} day{days !== 1 ? "s" : ""} overdue
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 6. LOG ACTIVITY MODAL */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl w-full max-w-xl shadow-2xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Log Activity
              </h3>
              <button
                title="Close"
                className="text-slate-500 hover:text-slate-500 dark:hover:text-slate-300"
                onClick={closeForm}
              >
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-4">
              <form
                id="activity-form"
                className="space-y-4"
                onSubmit={handleSubmit(onSubmit)}
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="act-type" className="label mb-1 block">
                      Activity Type <span className="text-red-400">*</span>
                    </label>
                    <select
                      id="act-type"
                      className="input"
                      {...register("type")}
                      title="Activity type"
                    >
                      {ACTIVITY_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    {errors.type && (
                      <p className="text-xs text-red-400 mt-1">
                        {errors.type.message}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="label mb-1 block">
                      Linked To <span className="text-red-400">*</span>
                    </label>
                    <div className="relative" ref={linkedSearchRef}>
                      <input
                        className="input pr-7 text-sm"
                        placeholder="Search lead or opportunity\u2026"
                        autoComplete="off"
                        value={linkedDisplay || linkedSearch}
                        onChange={(e) => {
                          setLinkedSearch(e.target.value);
                          setLinkedDisplay("");
                          setValue("leadId", "");
                          setValue("opportunityId", "");
                          setLinkedDropOpen(true);
                        }}
                        onFocus={() => {
                          if (!linkedDisplay) setLinkedDropOpen(true);
                        }}
                      />
                      {(linkedDisplay || linkedSearch) && (
                        <button
                          type="button"
                          title="Clear linked record"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-500 dark:hover:text-slate-300"
                          onClick={() => {
                            setLinkedDisplay("");
                            setLinkedSearch("");
                            setValue("leadId", "");
                            setValue("opportunityId", "");
                          }}
                        >
                          <X size={12} />
                        </button>
                      )}
                      {linkedDropOpen &&
                        (lsLeads.length > 0 || lsOpps.length > 0) && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl shadow-xl z-50 max-h-52 overflow-y-auto">
                            {lsLeads.length > 0 && (
                              <>
                                <p className="px-3 pt-2 pb-1 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                                  Leads
                                </p>
                                {lsLeads.map((l: any) => (
                                  <button
                                    key={l.id}
                                    type="button"
                                    className="w-full text-left px-3 py-2 text-xs hover:bg-slate-700 text-slate-800 dark:text-slate-200"
                                    onClick={() =>
                                      selectLinked("lead", l.id, l.companyName)
                                    }
                                  >
                                    <span className="font-medium">
                                      {l.companyName}
                                    </span>
                                    {l.contactName && (
                                      <span className="text-slate-500 ml-1">
                                        {"\u00B7"} {l.contactName}
                                      </span>
                                    )}
                                  </button>
                                ))}
                              </>
                            )}
                            {lsOpps.length > 0 && (
                              <>
                                <p className="px-3 pt-2 pb-1 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                                  Opportunities
                                </p>
                                {lsOpps.map((o: any) => (
                                  <button
                                    key={o.id}
                                    type="button"
                                    className="w-full text-left px-3 py-2 text-xs hover:bg-slate-700 text-slate-800 dark:text-slate-200"
                                    onClick={() =>
                                      selectLinked(
                                        "opportunity",
                                        o.id,
                                        o.opportunityName ?? o.title,
                                      )
                                    }
                                  >
                                    <span className="font-medium">
                                      {o.opportunityName ?? o.title}
                                    </span>
                                    {o.businessLine && (
                                      <span className="text-slate-500 ml-1">
                                        {"\u00B7"} {o.businessLine}
                                      </span>
                                    )}
                                  </button>
                                ))}
                              </>
                            )}
                          </div>
                        )}
                    </div>
                    {linkedToError && (
                      <p className="text-xs text-red-400 mt-1">
                        {linkedToError}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label mb-1 block">
                      Date &amp; Time <span className="text-red-400">*</span>
                    </label>
                    <input
                      className="input"
                      type="datetime-local"
                      max={new Date().toISOString().slice(0, 16)}
                      {...register("activityDate")}
                      title="Activity date and time"
                    />
                    {errors.activityDate && (
                      <p className="text-xs text-red-400 mt-1">
                        {errors.activityDate.message}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="label mb-1 block">Duration (mins)</label>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="e.g. 30"
                      {...register("duration")}
                      title="Duration in minutes"
                    />
                  </div>
                </div>

                <div>
                  <label className="label mb-1 block">
                    Outcome <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    className="input min-h-[96px]"
                    placeholder="What happened? e.g. Client interested, wants proposal by Friday\u2026"
                    maxLength={1000}
                    {...register("outcome")}
                  />
                  <p className="text-[10px] text-slate-600 mt-1 text-right">
                    {outcome.length}/1000
                  </p>
                  {errors.outcome && (
                    <p className="text-xs text-red-400 mt-1">
                      {errors.outcome.message}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label mb-1 block">
                      Next Action Date <span className="text-red-400">*</span>
                    </label>
                    <input
                      className="input"
                      type="date"
                      min={new Date().toISOString().split("T")[0]}
                      {...register("nextActionDate")}
                      title="Next action date"
                    />
                    {errors.nextActionDate && (
                      <p className="text-xs text-red-400 mt-1">
                        {errors.nextActionDate.message}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="label mb-1 block">Notes</label>
                    <input
                      className="input"
                      placeholder="Additional context (optional)"
                      maxLength={2000}
                      {...register("notes")}
                      title="Notes"
                    />
                  </div>
                </div>

                <div>
                  <label className="label mb-1 block">Logged By</label>
                  <div className="input flex items-center gap-2 opacity-60 cursor-not-allowed">
                    <User size={13} className="text-slate-500 flex-shrink-0" />
                    <span className="text-sm text-slate-400">
                      {currentUser?.name ?? "You"}
                    </span>
                  </div>
                </div>

                <p className="text-[11px] text-slate-600 bg-slate-100 dark:bg-slate-950 rounded-lg px-3 py-2 leading-relaxed">
                  On save {"\u2014"} system auto-updates parent
                  lead/opportunity:{" "}
                  <span className="text-slate-500">
                    last_contacted_date = today, follow_up_date = next action
                    date.
                  </span>{" "}
                  No second save needed.
                </p>
              </form>
            </div>

            <div className="flex gap-2 px-6 py-4 border-t border-slate-200 dark:border-white/[0.06]">
              <button
                type="button"
                className="btn-ghost flex-1"
                onClick={closeForm}
              >
                Cancel
              </button>
              <button
                type="submit"
                form="activity-form"
                className="btn-primary flex-1"
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? "Saving\u2026" : "Save activity"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. DELETE MODAL \u2014 admin only */}
      {deleteTarget && isAdmin && (
        <DeleteModal
          activity={deleteTarget}
          isPending={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
