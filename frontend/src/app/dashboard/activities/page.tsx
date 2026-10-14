"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activitiesApi,
  leadsApi,
  opportunitiesApi,
  usersApi,
} from "../../../lib/api";
import { Avatar, EmptyState, Pagination } from "../../../components/ui";
import { CountPill } from "../../../components/dashboards/DashboardUI";
import { cn, getInitials, timeAgo } from "../../../lib/utils";
import { readableActivityText } from "../../../lib/activityText";
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
  ChevronRight,
  Edit2,
  Activity as ActivityIcon,
  CalendarCheck,
  CalendarRange,
  Snowflake,
  Layers,
  Timer,
  Sun,
  Linkedin,
  Building2,
  Briefcase,
  Check,
  Cpu,
  Loader2,
  SlidersHorizontal,
  StickyNote,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import toast from "react-hot-toast";
import { Select } from '../../../components/ui/Select';

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

// == Date helpers ==
// Activity dates picked in a date input are stored as UTC midnight ("2026-10-12" →
// 2026-10-12T00:00:00Z), so their calendar day is the UTC date. Real timestamps
// (e.g. system timeline entries) use the viewer's local day. Next-action dates are
// always compared by their stored (UTC) date, matching what the user picked.
const pad2 = (n: number) => String(n).padStart(2, "0");
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function localDateKey(d: Date = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isUtcMidnight(d: Date) {
  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

function activityDayKey(raw?: string | null) {
  if (!raw) return "";
  if (DATE_ONLY.test(raw)) return raw;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  return isUtcMidnight(d) ? d.toISOString().slice(0, 10) : localDateKey(d);
}

function nextActionDayKey(raw?: string | null) {
  if (!raw) return "";
  if (DATE_ONLY.test(raw)) return raw;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function keyToDate(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function shiftKey(key: string, days: number) {
  const d = keyToDate(key);
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}

function daysBetweenKeys(from: string, to: string) {
  return Math.round((keyToDate(to).getTime() - keyToDate(from).getTime()) / 86_400_000);
}

/** Value to send for an activity date picked in the form: today → the current time, past day → the date. */
function activityDatePayload(key: string) {
  if (key !== localDateKey()) return key;
  // A small margin keeps client/server clock skew from tripping the "no future date" rule
  const startOfToday = keyToDate(key).getTime();
  return new Date(Math.max(Date.now() - 60_000, startOfToday)).toISOString();
}

/** Value to send for a next-action date: today keeps the existing end-of-day convention. */
function nextActionPayload(key: string) {
  return key === localDateKey() ? key + "T23:59:59" : key;
}

const activitySchema = yup.object({
  type: yup.string().required("Activity type is required"),
  activityDate: yup
    .string()
    .required("Activity date is required")
    .test(
      "not-future",
      "Activity date cannot be a future date",
      (value) => !value || value <= localDateKey(),
    ),
  duration: yup.string().default(""),
  linkedToType: yup.string().oneOf(["lead", "opportunity"]).required(),
  leadId: yup
    .string()
    .default("")
    .test(
      "linked-record",
      "Please select a lead or opportunity",
      function (value) {
        return !!value || !!this.parent.opportunityId;
      },
    ),
  opportunityId: yup.string().default(""),
  outcome: yup.string().required("Outcome is required"),
  nextActionDate: yup
    .string()
    .required("Next action date is required")
    .test(
      "today-or-future",
      "Next action date must be today or a future date",
      (value) => !value || value >= localDateKey(),
    ),
  notes: yup.string().default(""),
  description: yup.string().default(""),
});

// == Icon/color map ==
const ICON_MAP: Record<
  string,
  { icon: any; color: string; bg: string; text: string; solid: string }
> = {
  call: {
    icon: Phone,
    color: "blue",
    bg: "bg-blue-500/10",
    text: "text-blue-600 dark:text-blue-400",
    solid: "from-blue-500 to-indigo-600 shadow-blue-500/30",
  },
  email: {
    icon: Mail,
    color: "blue",
    bg: "bg-indigo-500/10",
    text: "text-indigo-600 dark:text-indigo-400",
    solid: "from-indigo-500 to-violet-600 shadow-indigo-500/30",
  },
  meeting: {
    icon: Calendar,
    color: "purple",
    bg: "bg-violet-500/10",
    text: "text-violet-600 dark:text-violet-400",
    solid: "from-violet-500 to-fuchsia-600 shadow-violet-500/30",
  },
  demo: {
    icon: Video,
    color: "green",
    bg: "bg-emerald-500/10",
    text: "text-emerald-600 dark:text-emerald-400",
    solid: "from-emerald-500 to-teal-600 shadow-emerald-500/30",
  },
  follow_up: {
    icon: RefreshCw,
    color: "amber",
    bg: "bg-amber-500/10",
    text: "text-amber-600 dark:text-amber-400",
    solid: "from-amber-400 to-orange-600 shadow-amber-500/30",
  },
  whatsapp: {
    icon: MessageSquare,
    color: "green",
    bg: "bg-green-500/10",
    text: "text-green-600 dark:text-green-400",
    solid: "from-green-500 to-emerald-600 shadow-green-500/30",
  },
  note: {
    icon: StickyNote,
    color: "gray",
    bg: "bg-slate-500/10",
    text: "text-slate-600 dark:text-slate-400",
    solid: "from-slate-500 to-slate-700 shadow-slate-500/30",
  },
  linkedin: {
    icon: Linkedin,
    color: "blue",
    bg: "bg-sky-500/10",
    text: "text-sky-600 dark:text-sky-400",
    solid: "from-sky-500 to-blue-600 shadow-sky-500/30",
  },
};
const DEFAULT_META = {
  icon: CheckSquare,
  color: "gray",
  bg: "bg-slate-500/10",
  text: "text-slate-600 dark:text-slate-400",
  solid: "from-slate-500 to-slate-700 shadow-slate-500/30",
};

const ACTIVITY_TYPES = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "demo", label: "Demo" },
  { value: "follow_up", label: "Follow Up" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "note", label: "Note" },
];

// == Helpers ==
/** Stored actions use both "follow-up" and "follow_up"; the UI uses "follow_up". */
function normalizeType(type?: string | null) {
  const t = (type ?? "note").toLowerCase();
  return t === "follow-up" ? "follow_up" : t;
}

/** Only user-logged activity types are editable; system timeline entries (lead_created, status_changed, lead_assigned …) are not. */
function isLoggableType(type?: string | null) {
  const t = normalizeType(type);
  return ACTIVITY_TYPES.some((x) => x.value === t);
}

function activityType(activity: any) {
  return normalizeType(activity?.action ?? activity?.type);
}

function getTypeMeta(type: string) {
  const safeType = normalizeType(type);
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

function formatActivityDate(raw: string) {
  if (!raw) return "";
  const key = activityDayKey(raw);
  if (!key) return "";
  const d = new Date(raw);
  const hasTime = !DATE_ONLY.test(raw) && !isUtcMidnight(d);
  const time = hasTime
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "";
  const today = localDateKey();
  if (key === today) return "Today" + (time ? ", " + time : "");
  if (key === shiftKey(today, -1)) return "Yesterday" + (time ? ", " + time : "");
  return keyToDate(key).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Clock time of an activity for the timeline rail; "" for date-only entries. */
function activityTimeLabel(activity: any) {
  const raw = activity.activityDate || activity.createdAt;
  if (!raw || DATE_ONLY.test(raw)) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime()) || isUtcMidnight(d)) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatDateKey(key: string) {
  if (!key) return "";
  const d = keyToDate(key);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function isOverdueNextAction(raw?: string | null) {
  const key = nextActionDayKey(raw);
  return !!key && key < localDateKey();
}

/** Whole days from a next-action date to today (positive when overdue). */
function daysSinceNextAction(raw?: string | null) {
  const key = nextActionDayKey(raw);
  return key ? daysBetweenKeys(key, localDateKey()) : 0;
}

/** Whole days from an activity's date to today. */
function daysSinceActivity(raw?: string | null) {
  const key = activityDayKey(raw);
  return key ? daysBetweenKeys(key, localDateKey()) : 0;
}

function getNextActionDisplay(
  raw: string,
): { label: string; color: string; status: "overdue" | "due_today" | "upcoming" } | null {
  const key = nextActionDayKey(raw);
  if (!key) return null;
  const today = localDateKey();
  if (key === today)
    return {
      label: formatDateKey(key) + " (due today)",
      color: "text-amber-600 dark:text-amber-400",
      status: "due_today",
    };
  if (key < today) {
    const days = daysBetweenKeys(key, today);
    return {
      label: formatDateKey(key) + " — " + days + (days === 1 ? " day" : " days") + " overdue",
      color: "text-rose-600 dark:text-rose-400",
      status: "overdue",
    };
  }
  return { label: formatDateKey(key), color: "text-blue-600 dark:text-blue-400", status: "upcoming" };
}

function groupActivitiesByDate(activities: any[]) {
  const groups: Record<string, any[]> = {};
  const today = localDateKey();
  const yesterday = shiftKey(today, -1);
  activities.forEach((a) => {
    const dayKey = activityDayKey(a.activityDate || a.createdAt);
    let key: string;
    if (!dayKey) key = "Undated";
    else if (dayKey === today) key = "Today";
    else if (dayKey === yesterday) key = "Yesterday";
    else
      key = keyToDate(dayKey).toLocaleDateString("en-US", {
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

/** Linked record of an activity. Opportunity activities also carry the opportunity's lead for context. */
function getLinkedRecord(activity: any) {
  const isOpp =
    activity.linkedType === "opportunity" ||
    (!activity.leadId && !!activity.opportunityId);
  if (isOpp && activity.opportunityId) {
    return {
      type: "opportunity" as const,
      name:
        activity.opportunity?.opportunityName ||
        activity.opportunity?.title ||
        "Opportunity",
      href: "/dashboard/opportunities?focus=" + activity.opportunityId,
      context: activity.lead?.companyName ?? null,
    };
  }
  if (activity.leadId) {
    return {
      type: "lead" as const,
      name: activity.lead?.companyName || "Lead",
      href: "/dashboard/leads/" + activity.leadId,
      context: null,
    };
  }
  return null;
}

// == Shared presentational bits ==
const OVERLAY =
  "fixed inset-0 flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/50 backdrop-blur-[2px] animate-fade-in";
const PANEL =
  "bg-surface border border-line w-full shadow-2xl flex flex-col max-h-[92vh] rounded-t-2xl sm:rounded-2xl overflow-hidden";
const ICON_BTN =
  "w-8 h-8 rounded-lg flex items-center justify-center text-ink-3 hover:text-ink hover:bg-sunken dark:hover:bg-white/[0.06] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40";

const NEXT_ACTION_TONE = {
  overdue: {
    chip: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20",
    box: "bg-rose-50 dark:bg-rose-500/[0.07] border-rose-200 dark:border-rose-500/20",
    text: "text-rose-600 dark:text-rose-400",
  },
  due_today: {
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20",
    box: "bg-amber-50 dark:bg-amber-500/[0.07] border-amber-200 dark:border-amber-500/20",
    text: "text-amber-600 dark:text-amber-400",
  },
  upcoming: {
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20",
    box: "bg-emerald-50 dark:bg-emerald-500/[0.07] border-emerald-200 dark:border-emerald-500/20",
    text: "text-emerald-600 dark:text-emerald-400",
  },
} as const;

function TypeIcon({ meta, size = "md" }: { meta: ReturnType<typeof getTypeMeta>; size?: "sm" | "md" }) {
  const Icon = meta.icon;
  return (
    <div
      className={cn(
        "rounded-xl flex items-center justify-center flex-shrink-0 ring-1 ring-inset ring-black/[0.04] dark:ring-white/[0.06]",
        size === "sm" ? "w-8 h-8" : "w-10 h-10",
        meta.bg,
        meta.text,
      )}
    >
      <Icon size={size === "sm" ? 15 : 17} strokeWidth={2} />
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400 mt-1.5">
      <AlertTriangle size={11} className="flex-shrink-0" /> {message}
    </p>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="flex items-center gap-2 w-full text-[13px] font-semibold text-ink mb-3">
        {title}
        <span className="flex-1 h-px bg-line" aria-hidden="true" />
      </legend>
      {children}
    </fieldset>
  );
}

function Req() {
  return <span className="text-rose-500" aria-hidden="true">*</span>;
}

// == Activity Row ==
function ActivityRow({
  activity,
  showLoggedBy,
  canDelete,
  onDelete,
  onClick,
  variant = "list",
  isLast = false,
}: {
  activity: any;
  showLoggedBy: boolean;
  canDelete: boolean;
  onDelete?: (activity: any) => void;
  onClick?: (activity: any) => void;
  variant?: "list" | "timeline";
  isLast?: boolean;
}) {
  const typeValue = activityType(activity);
  const meta = getTypeMeta(typeValue);
  const isSystem = !isLoggableType(typeValue);
  const nextAction = activity.nextActionDate
    ? getNextActionDisplay(activity.nextActionDate)
    : null;
  const isOverdue = nextAction?.status === "overdue";
  const linked = getLinkedRecord(activity);
  const ownerName = activity.user?.name ?? null;
  // System entries carry their text in description; logged activities in outcome
  const summary = activity.outcome || readableActivityText(activity.description);
  const isTimeline = variant === "timeline";
  const timeLabel = isTimeline ? activityTimeLabel(activity) : "";

  const body = (
    <div className="flex-1 min-w-0">
      {/* Title line: type + date */}
      <div className="flex items-start justify-between gap-x-3 gap-y-1 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("text-sm font-semibold", isSystem ? "text-ink-2" : "text-ink")}>
            {meta.label}
          </span>
          {isSystem && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-sunken text-ink-3 ring-1 ring-inset ring-line">
              <Cpu size={9} /> System
            </span>
          )}
          {isOverdue && (
            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-rose-500/10 text-rose-700 dark:text-rose-300">
              Overdue
            </span>
          )}
        </div>
        <span className={cn("inline-flex items-center gap-1.5 text-xs text-ink-3 whitespace-nowrap tabular-nums", isTimeline && "sm:hidden")}>
          <Clock size={11} className="flex-shrink-0" />
          {activity.activityDate
            ? formatActivityDate(activity.activityDate)
            : timeAgo(activity.createdAt)}
          {activity.duration ? (
            <>
              <span className="text-ink-3/50">{"·"}</span>
              <Timer size={11} className="flex-shrink-0" />
              {activity.duration + " mins"}
            </>
          ) : null}
        </span>
      </div>

      {/* Linked record */}
      {linked && (
        <div className="flex items-center gap-1.5 mt-1 min-w-0 text-xs">
          {linked.type === "lead" ? (
            <Building2 size={12} className="text-ink-3 flex-shrink-0" />
          ) : (
            <Briefcase size={12} className="text-ink-3 flex-shrink-0" />
          )}
          <a
            href={linked.href}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-ink-2 hover:text-blue-600 dark:hover:text-blue-400 hover:underline underline-offset-2 truncate max-w-[220px] transition-colors"
          >
            {linked.name}
          </a>
          <span
            className={cn(
              "text-[10px] px-1.5 py-px rounded font-semibold uppercase tracking-wider flex-shrink-0",
              linked.type === "lead"
                ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
                : "bg-violet-500/10 text-violet-700 dark:text-violet-300",
            )}
          >
            {linked.type === "lead" ? "Lead" : "Opportunity"}
          </span>
          {linked.context && (
            <span className="text-ink-3 truncate max-w-[160px]">
              {"·"} {linked.context}
            </span>
          )}
        </div>
      )}

      {/* Summary */}
      {summary && (
        <p className="text-[13px] text-ink-2 mt-2 line-clamp-2 leading-relaxed break-words">
          {summary}
        </p>
      )}
      {activity.notes && activity.notes !== summary && (
        <p className="flex items-start gap-1.5 text-xs text-ink-3 mt-1 min-w-0">
          <StickyNote size={11} className="flex-shrink-0 mt-[3px]" />
          <span className="line-clamp-1 break-words">{activity.notes}</span>
        </p>
      )}

      {/* Meta line */}
      {((showLoggedBy && ownerName) || nextAction || (canDelete && onDelete)) && (
        <div className="flex items-center gap-x-3 gap-y-2 mt-2.5 flex-wrap">
          {showLoggedBy && ownerName && (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">
              <Avatar initials={getInitials(ownerName)} size="xs" />
              <span className="font-medium text-ink-2">{ownerName}</span>
            </span>
          )}
          {nextAction && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md ring-1 ring-inset",
                NEXT_ACTION_TONE[nextAction.status].chip,
              )}
            >
              <CalendarCheck size={11} /> Next: {nextAction.label}
            </span>
          )}
          {canDelete && onDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(activity); }}
              className="ml-auto inline-flex items-center gap-1 h-7 px-2 text-[11px] font-semibold rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-all sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
              title="Delete activity"
            >
              <Trash2 size={12} /> Delete
            </button>
          )}
        </div>
      )}
    </div>
  );

  const interactive = {
    role: "button" as const,
    tabIndex: 0,
    onClick: () => onClick?.(activity),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick?.(activity);
      }
    },
  };

  if (isTimeline) {
    return (
      <div className="relative flex gap-3">
        {/* time rail */}
        <div className="hidden sm:block w-[72px] flex-shrink-0 pt-3 text-right">
          <p className={cn("text-xs font-semibold tabular-nums", timeLabel ? "text-ink" : "text-ink-3")}>
            {timeLabel || "—"}
          </p>
          {activity.duration ? (
            <p className="text-[11px] text-ink-3 tabular-nums mt-0.5">{activity.duration} mins</p>
          ) : null}
        </div>
        {/* marker + connector */}
        <div className="relative flex-shrink-0 w-8 self-stretch">
          {!isLast && (
            <span className="absolute left-1/2 -translate-x-1/2 top-[46px] -bottom-2.5 w-px bg-line" aria-hidden="true" />
          )}
          <div className="relative z-[1] mt-2.5 rounded-xl bg-surface ring-4 ring-surface">
            <TypeIcon meta={meta} size="sm" />
            {nextAction && nextAction.status !== "upcoming" && (
              <span
                className={cn(
                  "absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-surface",
                  nextAction.status === "overdue" ? "bg-rose-500" : "bg-amber-500",
                )}
                title={nextAction.status === "overdue" ? "Follow-up overdue" : "Follow-up due today"}
              />
            )}
          </div>
        </div>
        <div
          {...interactive}
          className="group flex-1 min-w-0 mb-2 rounded-xl border border-transparent px-3.5 py-2.5 cursor-pointer transition-colors hover:border-line hover:bg-sunken/60 dark:hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        >
          {body}
        </div>
      </div>
    );
  }

  return (
    <div
      {...interactive}
      className={cn(
        "group relative px-4 sm:px-5 py-4 cursor-pointer transition-colors hover:bg-sunken/60 dark:hover:bg-white/[0.02] focus-visible:outline-none focus-visible:bg-sunken/60",
        isOverdue && "before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[3px] before:rounded-r before:bg-rose-500/70",
      )}
    >
      <div className="flex items-start gap-3.5">
        <TypeIcon meta={meta} />
        {body}
      </div>
    </div>
  );
}

function ActivityListSkeleton() {
  return (
    <div className="divide-y divide-line" aria-busy="true" aria-label="Loading activities">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="px-4 sm:px-5 py-4 flex items-start gap-3.5 animate-pulse">
          <div className="w-10 h-10 rounded-xl bg-sunken dark:bg-white/[0.05]" />
          <div className="flex-1 space-y-2.5 pt-0.5">
            <div className="flex justify-between gap-4">
              <div className="h-3.5 w-28 rounded bg-sunken dark:bg-white/[0.06]" />
              <div className="h-3 w-20 rounded bg-sunken dark:bg-white/[0.05]" />
            </div>
            <div className="h-3 w-40 rounded bg-sunken dark:bg-white/[0.05]" />
            <div className="h-3 w-3/4 rounded bg-sunken dark:bg-white/[0.04]" />
          </div>
        </div>
      ))}
    </div>
  );
}

// == Activity Table (wide screens) ==
function ActivityTable({
  activities,
  showLoggedBy,
  canDelete,
  onDelete,
  onClick,
}: {
  activities: any[];
  showLoggedBy: boolean;
  canDelete: boolean;
  onDelete?: (activity: any) => void;
  onClick?: (activity: any) => void;
}) {
  const th = "px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3 whitespace-nowrap";
  return (
    <table className="w-full table-fixed text-sm">
      <thead className="bg-sunken/50 dark:bg-white/[0.02] border-b border-line">
        <tr>
          <th className={cn(th, "pl-5")}>Activity</th>
          <th className={cn(th, "w-[200px]")}>Linked record</th>
          {showLoggedBy && <th className={cn(th, "w-[160px]")}>Logged by</th>}
          <th className={cn(th, "w-[140px]")}>Date</th>
          <th className={cn(th, "w-[190px]")}>Next action</th>
          <th className={cn(th, "w-[52px] pr-5")}><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {activities.map((activity) => {
          const typeValue = activityType(activity);
          const meta = getTypeMeta(typeValue);
          const isSystem = !isLoggableType(typeValue);
          const linked = getLinkedRecord(activity);
          const nextAction = activity.nextActionDate ? getNextActionDisplay(activity.nextActionDate) : null;
          const isOverdue = nextAction?.status === "overdue";
          const ownerName = activity.user?.name ?? null;
          const summary = activity.outcome || readableActivityText(activity.description);
          return (
            <tr
              key={activity.id}
              tabIndex={0}
              onClick={() => onClick?.(activity)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClick?.(activity);
                }
              }}
              className="group cursor-pointer align-top transition-colors hover:bg-sunken/60 dark:hover:bg-white/[0.02] focus-visible:outline-none focus-visible:bg-sunken/60"
            >
              {/* Activity */}
              <td className={cn("relative pl-5 pr-3 py-3.5", isOverdue && "before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[3px] before:rounded-r before:bg-rose-500/70")}>
                <div className="flex items-start gap-3 min-w-0">
                  <TypeIcon meta={meta} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn("font-semibold truncate", isSystem ? "text-ink-2" : "text-ink")}>{meta.label}</span>
                      {isSystem && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-sunken text-ink-3 ring-1 ring-inset ring-line flex-shrink-0">
                          <Cpu size={9} /> System
                        </span>
                      )}
                    </div>
                    {summary ? (
                      <p className="text-[13px] text-ink-2 mt-0.5 line-clamp-1 break-words" title={summary}>{summary}</p>
                    ) : (
                      <p className="text-[13px] text-ink-3 mt-0.5">No outcome recorded</p>
                    )}
                    {activity.notes && activity.notes !== summary && (
                      <p className="flex items-center gap-1.5 text-xs text-ink-3 mt-0.5 min-w-0">
                        <StickyNote size={11} className="flex-shrink-0" />
                        <span className="truncate">{activity.notes}</span>
                      </p>
                    )}
                  </div>
                </div>
              </td>

              {/* Linked record */}
              <td className="px-3 py-3.5">
                {linked ? (
                  <div className="min-w-0">
                    <a
                      href={linked.href}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1.5 font-medium text-ink hover:text-blue-600 dark:hover:text-blue-400 transition-colors min-w-0"
                      title={linked.name}
                    >
                      {linked.type === "lead" ? (
                        <Building2 size={13} className="text-ink-3 flex-shrink-0" />
                      ) : (
                        <Briefcase size={13} className="text-ink-3 flex-shrink-0" />
                      )}
                      <span className="truncate hover:underline underline-offset-2">{linked.name}</span>
                    </a>
                    <div className="flex items-center gap-1.5 mt-1 min-w-0">
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-px rounded font-semibold uppercase tracking-wider flex-shrink-0",
                          linked.type === "lead"
                            ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
                            : "bg-violet-500/10 text-violet-700 dark:text-violet-300",
                        )}
                      >
                        {linked.type === "lead" ? "Lead" : "Opportunity"}
                      </span>
                      {linked.context && <span className="text-xs text-ink-3 truncate">{linked.context}</span>}
                    </div>
                  </div>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </td>

              {/* Logged by */}
              {showLoggedBy && (
                <td className="px-3 py-3.5">
                  {ownerName ? (
                    <span className="flex items-center gap-2 min-w-0">
                      <Avatar initials={getInitials(ownerName)} size="xs" />
                      <span className="text-[13px] font-medium text-ink-2 truncate">{ownerName}</span>
                    </span>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </td>
              )}

              {/* Date */}
              <td className="px-3 py-3.5">
                <p className="text-[13px] text-ink tabular-nums whitespace-nowrap">
                  {activity.activityDate ? formatActivityDate(activity.activityDate) : timeAgo(activity.createdAt)}
                </p>
                {activity.duration ? (
                  <p className="flex items-center gap-1 text-xs text-ink-3 mt-0.5 tabular-nums">
                    <Timer size={11} /> {activity.duration} mins
                  </p>
                ) : null}
              </td>

              {/* Next action */}
              <td className="px-3 py-3.5">
                {nextAction ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 max-w-full text-[11px] font-medium px-2 py-1 rounded-md ring-1 ring-inset",
                      NEXT_ACTION_TONE[nextAction.status].chip,
                    )}
                  >
                    <CalendarCheck size={11} className="flex-shrink-0" />
                    <span className="truncate">{nextAction.label}</span>
                  </span>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </td>

              {/* Actions */}
              <td className="pl-1 pr-5 py-3 text-right">
                {canDelete && onDelete ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDelete(activity); }}
                    className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-ink-3 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 focus-visible:opacity-100 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
                    title="Delete activity"
                    aria-label="Delete activity"
                  >
                    <Trash2 size={14} />
                  </button>
                ) : (
                  <ChevronRight size={15} className="inline-block mt-2 text-ink-3 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// == Stat tile ==
const STAT_TONE: Record<string, string> = {
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  cyan: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
};

function StatTile({
  icon: Icon,
  tone,
  label,
  value,
  sub,
  alert,
}: {
  icon: any;
  tone: string;
  label: string;
  value: number;
  sub: string;
  alert?: boolean;
}) {
  return (
    <div className="card px-4 py-4 flex items-center gap-3.5 min-w-0">
      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", STAT_TONE[tone] ?? STAT_TONE.blue)}>
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-ink-3 truncate">{label}</p>
        <div className="flex items-baseline gap-2 mt-0.5 min-w-0">
          <span
            className={cn(
              "font-display text-[22px] leading-none font-semibold tracking-[-0.03em] tabular-nums",
              alert ? "text-rose-600 dark:text-rose-400" : "text-ink",
            )}
          >
            {value}
          </span>
          <span className="text-xs text-ink-3 truncate">{sub}</span>
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
  const meta = getTypeMeta(activityType(activity));
  const linked = getLinkedRecord(activity);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isPending, onCancel]);

  return (
    <div className={cn(OVERLAY, "z-[60]")} role="dialog" aria-modal="true" aria-labelledby="delete-activity-title">
      <div className={cn(PANEL, "sm:max-w-md")}>
        <div className="p-6 space-y-5">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-8 ring-rose-500/[0.05] flex items-center justify-center flex-shrink-0">
              <Trash2 size={19} />
            </div>
            <div className="min-w-0 pt-0.5">
              <h3 id="delete-activity-title" className="font-display text-base font-semibold text-ink">
                Delete this activity?
              </h3>
              <p className="text-sm text-ink-2 leading-relaxed mt-1">
                Are you sure you want to delete this activity?
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-line bg-sunken/60 dark:bg-white/[0.02] px-3.5 py-3">
            <TypeIcon meta={meta} size="sm" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink truncate">{meta.label}</p>
              <p className="text-xs text-ink-3 truncate">
                {linked ? linked.name : "Not linked"}
                {activity.activityDate ? " · " + formatActivityDate(activity.activityDate) : ""}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-col-reverse sm:flex-row gap-2 px-6 py-4 border-t border-line bg-sunken/50 dark:bg-white/[0.02]">
          <button
            type="button"
            className="btn-ghost sm:flex-1 justify-center"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="sm:flex-1 inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            {isPending ? "Deleting…" : "Yes, delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// == View / Edit Modal ==
// An unchanged next-action date is always accepted, so an overdue activity can still be
// edited (outcome, notes …) without being forced to reschedule it.
const editActivitySchema = (originalNextKey: string) =>
  yup.object({
    type: yup.string().required("Activity type is required"),
    activityDate: yup.string().required("Activity date is required").test(
      "not-future", "Activity date cannot be a future date",
      (v) => !v || v <= localDateKey(),
    ),
    duration: yup.string().default(""),
    outcome: yup.string().default(""),
    nextActionDate: yup.string().required("Next action date is required").test(
      "today-or-future", "Next action date must be today or a future date",
      (v) => !v || v === originalNextKey || v >= localDateKey(),
    ),
    notes: yup.string().default(""),
    description: yup.string().default(""),
  });

function ViewEditModal({
  activity,
  canEdit,
  onClose,
  onSaved,
}: {
  activity: any;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const typeValue = activityType(activity);
  const meta = getTypeMeta(typeValue);
  const editable = canEdit && isLoggableType(typeValue);
  const isSystem = !isLoggableType(typeValue);

  const originalDateKey = activityDayKey(activity.activityDate);
  const originalNextKey = nextActionDayKey(activity.nextActionDate);
  const todayKey = localDateKey();
  const schema = useMemo(() => editActivitySchema(originalNextKey), [originalNextKey]);

  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    defaultValues: {
      type: isLoggableType(typeValue) ? typeValue : "call",
      activityDate: originalDateKey,
      duration: activity.duration ? String(activity.duration) : "",
      outcome: activity.outcome || "",
      nextActionDate: originalNextKey,
      notes: activity.notes || "",
      description: activity.description || "",
    },
    resolver: yupResolver(schema) as any,
    mode: "onBlur",
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => activitiesApi.update(activity.id, data),
    onSuccess: () => {
      toast.success("Activity updated");
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.message || "Failed to update activity"),
  });

  function onSubmit(values: any) {
    const payload: any = {
      type: values.type,
      outcome: values.outcome || undefined,
      notes: values.notes || undefined,
    };
    // Dates are only sent when changed, so untouched values keep their stored time
    if (values.activityDate && values.activityDate !== originalDateKey)
      payload.activityDate = activityDatePayload(values.activityDate);
    if (values.nextActionDate && values.nextActionDate !== originalNextKey)
      payload.nextActionDate = nextActionPayload(values.nextActionDate);
    // Activities created here copy the outcome into description; keep the two in step
    if (activity.description && activity.description === activity.outcome && values.outcome)
      payload.description = values.outcome;
    if (values.duration) payload.duration = parseInt(values.duration, 10);
    updateMutation.mutate(payload);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !updateMutation.isPending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, updateMutation.isPending]);

  const linked = getLinkedRecord(activity);
  const nextAction = activity.nextActionDate ? getNextActionDisplay(activity.nextActionDate) : null;
  const showDescription = !!activity.description && activity.description !== activity.outcome;

  return (
    <div className={cn(OVERLAY, "z-[60]")} onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="view-activity-title">
      <div className={cn(PANEL, "sm:max-w-lg")} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start gap-3 px-5 sm:px-6 py-4 border-b border-line">
          <TypeIcon meta={meta} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 id="view-activity-title" className="font-display text-[15px] font-semibold text-ink">
                {editMode ? "Edit " + meta.label : meta.label}
              </h3>
              {isSystem && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-sunken text-ink-3 ring-1 ring-inset ring-line">
                  <Cpu size={9} /> System
                </span>
              )}
            </div>
            {linked ? (
              <p className="text-xs text-ink-3 truncate mt-0.5">
                <a href={linked.href} className="font-medium text-ink-2 hover:text-blue-600 dark:hover:text-blue-400 hover:underline underline-offset-2">
                  {linked.name}
                </a>
                {" · "}{linked.type === "lead" ? "Lead" : "Opportunity"}
                {linked.context ? " · " + linked.context : ""}
              </p>
            ) : (
              <p className="text-xs text-ink-3 mt-0.5">Not linked to a record</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {!editMode && editable && (
              <button
                type="button"
                onClick={() => setEditMode(true)}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg text-blue-600 dark:text-blue-400 bg-blue-500/[0.08] hover:bg-blue-500/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                <Edit2 size={13} /> Edit
              </button>
            )}
            <button type="button" onClick={onClose} title="Close" aria-label="Close" className={ICON_BTN}>
              <X size={17} />
            </button>
          </div>
        </div>

        {editMode ? (
          /* ── Edit form ── */
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col min-h-0 flex-1">
            <div className="px-5 sm:px-6 py-5 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label mb-1.5 block">Activity Type</label>
                  <Select {...register("type")} className="input">
                    {ACTIVITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </Select>
                  <FieldError message={errors.type?.message as string} />
                </div>
                <div>
                  <label htmlFor="edit-activity-date" className="label mb-1.5 block">Activity Date</label>
                  <input id="edit-activity-date" type="date" {...register("activityDate")} className="input" max={todayKey} />
                  <FieldError message={errors.activityDate?.message as string} />
                </div>
                <div>
                  <label htmlFor="edit-duration" className="label mb-1.5 block">Duration (mins)</label>
                  <input id="edit-duration" type="number" min="1" {...register("duration")} className="input" placeholder="e.g. 30" />
                </div>
                <div>
                  <label htmlFor="edit-next-action" className="label mb-1.5 block">Next Action Date <Req /></label>
                  <input
                    id="edit-next-action"
                    type="date"
                    {...register("nextActionDate")}
                    className="input"
                    min={originalNextKey && originalNextKey < todayKey ? originalNextKey : todayKey}
                  />
                  <FieldError message={errors.nextActionDate?.message as string} />
                  {!errors.nextActionDate && originalNextKey && originalNextKey < todayKey && (
                    <p className="text-[11px] text-ink-3 mt-1.5">Overdue {"—"} pick today or later to reschedule.</p>
                  )}
                </div>
              </div>
              <div>
                <label htmlFor="edit-outcome" className="label mb-1.5 block">Outcome</label>
                <textarea id="edit-outcome" {...register("outcome")} className="input resize-none leading-relaxed" rows={3} maxLength={1000} placeholder="What happened?" />
              </div>
              <div>
                <label htmlFor="edit-notes" className="label mb-1.5 block">Notes</label>
                <textarea id="edit-notes" {...register("notes")} className="input resize-none leading-relaxed" rows={2} maxLength={2000} placeholder="Internal notes…" />
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row gap-2 px-5 sm:px-6 py-4 border-t border-line bg-sunken/50 dark:bg-white/[0.02]">
              <button type="button" className="btn-ghost sm:flex-1 justify-center py-2.5" onClick={() => { setEditMode(false); reset(); }} disabled={updateMutation.isPending}>
                Cancel
              </button>
              <button type="submit" className="btn-primary sm:flex-1 justify-center py-2.5" disabled={updateMutation.isPending}>
                {updateMutation.isPending && <Loader2 size={15} className="animate-spin" />}
                {updateMutation.isPending ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        ) : (
          /* ── View mode ── */
          <div className="px-5 sm:px-6 py-5 space-y-5 overflow-y-auto">
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-sunken/60 dark:bg-white/[0.03] border border-line px-3.5 py-3">
                <dt className="flex items-center gap-1.5 text-[10px] font-semibold text-ink-3 uppercase tracking-wider mb-1"><Calendar size={11} /> Date</dt>
                <dd className="text-sm font-semibold text-ink">
                  {activity.activityDate ? formatActivityDate(activity.activityDate) : "—"}
                </dd>
              </div>
              <div className="rounded-xl bg-sunken/60 dark:bg-white/[0.03] border border-line px-3.5 py-3">
                <dt className="flex items-center gap-1.5 text-[10px] font-semibold text-ink-3 uppercase tracking-wider mb-1"><Timer size={11} /> Duration</dt>
                <dd className="text-sm font-semibold text-ink">
                  {activity.duration ? activity.duration + " mins" : "—"}
                </dd>
              </div>
            </dl>

            {nextAction && (
              <div className={cn("flex items-center gap-3 rounded-xl px-3.5 py-3 border", NEXT_ACTION_TONE[nextAction.status].box)}>
                <CalendarCheck size={16} className={NEXT_ACTION_TONE[nextAction.status].text} />
                <div>
                  <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider">Next Action Date</p>
                  <p className={cn("text-sm font-semibold", NEXT_ACTION_TONE[nextAction.status].text)}>
                    {nextAction.label}
                  </p>
                </div>
              </div>
            )}

            {activity.outcome && (
              <div>
                <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider mb-1.5">Outcome</p>
                <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap break-words">{activity.outcome}</p>
              </div>
            )}
            {showDescription && (
              <div>
                <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider mb-1.5">Description</p>
                <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap break-words">{readableActivityText(activity.description)}</p>
              </div>
            )}
            {activity.notes && (
              <div>
                <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider mb-1.5">Notes</p>
                <p className="text-sm text-ink-2 leading-relaxed whitespace-pre-wrap break-words rounded-xl bg-sunken/60 dark:bg-white/[0.03] border border-line px-3.5 py-3">{activity.notes}</p>
              </div>
            )}
            {!activity.outcome && !showDescription && !activity.notes && (
              <p className="text-sm text-ink-3 italic">No outcome or notes recorded.</p>
            )}

            {(activity.user?.name || activity.createdAt) && (
              <div className="pt-4 border-t border-line flex items-center gap-2.5">
                {activity.user?.name ? (
                  <Avatar initials={getInitials(activity.user.name)} size="xs" />
                ) : (
                  <User size={13} className="text-ink-3" />
                )}
                <p className="text-xs text-ink-3">
                  {activity.user?.name && <>Logged by <span className="font-semibold text-ink">{activity.user.name}</span></>}
                  {activity.createdAt && <>{activity.user?.name ? " · " : "Logged "}{timeAgo(activity.createdAt)}</>}
                </p>
              </div>
            )}
          </div>
        )}
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
  const [showAllAlerts, setShowAllAlerts] = useState(false);
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
  const [lsLeadsAll, setLsLeadsAll] = useState<any[]>([]);
  const [lsLeadsPage, setLsLeadsPage] = useState(1);
  const [lsLeadsHasMore, setLsLeadsHasMore] = useState(false);
  const LS_PAGE_SIZE = 50;
  const [flLeadsAll, setFlLeadsAll] = useState<any[]>([]);
  const [flLeadsPage, setFlLeadsPage] = useState(1);
  const [flLeadsHasMore, setFlLeadsHasMore] = useState(false);
  const FL_PAGE_SIZE = 50;

  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [selectedActivity, setSelectedActivity] = useState<any>(null);
  const [limit, setLimit] = useState(20);

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

  // Full reset only when search changes
  useEffect(() => {
    setLsLeadsAll([]);
    setLsLeadsPage(1);
    setLsLeadsHasMore(false);
  }, [debouncedLS]);

  // On close, reset page to 1 so re-open always starts fresh from page 1
  useEffect(() => {
    if (!linkedDropOpen) setLsLeadsPage(1);
  }, [linkedDropOpen]);

  useEffect(() => {
    setFlLeadsAll([]);
    setFlLeadsPage(1);
    setFlLeadsHasMore(false);
  }, [debouncedLTFQ]);

  useEffect(() => {
    if (!showLinkedFilter) setFlLeadsPage(1);
  }, [showLinkedFilter]);

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
  const stats = useMemo(() => {
    const today = localDateKey();
    // Week runs Sunday → Saturday
    const weekStart = shiftKey(today, -new Date().getDay());
    const weekEnd = shiftKey(weekStart, 7);
    const dayOf = (a: any) => activityDayKey(a.activityDate || a.createdAt);
    return {
      today: allForStats.filter((a) => dayOf(a) === today).length,
      thisWeek: allForStats.filter((a) => {
        const k = dayOf(a);
        return !!k && k >= weekStart && k < weekEnd;
      }).length,
      followUps: allForStats.filter((a) => nextActionDayKey(a.nextActionDate) === today).length,
      overdue: allForStats.filter((a) => isOverdueNextAction(a.nextActionDate)).length,
      total: allForStats.length,
    };
  }, [allForStats]);

  const overdueActivities = useMemo(
    () =>
      allForStats
        .filter((a) => isOverdueNextAction(a.nextActionDate))
        .sort(
          (a, b) => daysSinceNextAction(b.nextActionDate) - daysSinceNextAction(a.nextActionDate),
        ),
    [allForStats],
  );

  // List query
  const listParams: any = { page, limit, ...baseParams };
  if (debouncedSearch) listParams.search = debouncedSearch;
  if (typeFilter) listParams.type = typeFilter;
  if (loggedByFilter) listParams.executiveId = loggedByFilter;
  if (linkedToFilterId) listParams.leadId = linkedToFilterId;
  if (dateFilter) {
    const now = new Date();
    // Calendar days in the viewer's timezone (toISOString would give the UTC day,
    // which is "yesterday" in IST between midnight and 05:30)
    if (dateFilter === "today") {
      listParams.dateFrom = localDateKey(now);
      listParams.dateTo = localDateKey(now);
    } else if (dateFilter === "week") {
      listParams.dateFrom = shiftKey(localDateKey(now), -now.getDay());
    } else if (dateFilter === "month") {
      listParams.dateFrom = localDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
    }
  }

  const { data: listData, isLoading, isFetching, isError, refetch } = useQuery({
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

  // Linked-to search for form — paginated, role-scoped via baseParams
  const { data: lsLeadsRaw, isFetching: lsLeadsFetching } = useQuery({
    queryKey: ["ls-leads", debouncedLS, lsLeadsPage, baseParams],
    queryFn: () =>
      leadsApi
        .list({
          ...(debouncedLS ? { search: debouncedLS } : {}),
          limit: LS_PAGE_SIZE,
          page: lsLeadsPage,
          ...baseParams,
        })
        .then((r) => r.data?.data ?? []),
    enabled: linkedDropOpen,
    staleTime: 10_000,
  });
  // Accumulate pages into lsLeadsAll; also fires on re-open to repopulate from cache
  useEffect(() => {
    if (!Array.isArray(lsLeadsRaw) || !linkedDropOpen) return;
    setLsLeadsAll((prev) =>
      lsLeadsPage === 1
        ? lsLeadsRaw
        : [...prev, ...lsLeadsRaw.filter((l: any) => !prev.some((p: any) => p.id === l.id))]
    );
    setLsLeadsHasMore(lsLeadsRaw.length >= LS_PAGE_SIZE);
  }, [lsLeadsRaw, linkedDropOpen]);

  const { data: lsOppsRaw } = useQuery({
    queryKey: ["ls-opps", debouncedLS, baseParams],
    queryFn: () =>
      opportunitiesApi
        .list({ search: debouncedLS, limit: 5, ...baseParams })
        .then((r) => r.data?.data ?? r.data ?? []),
    enabled: linkedDropOpen && debouncedLS.length >= 1,
    staleTime: 10_000,
  });
  const lsOpps = Array.isArray(lsOppsRaw) ? lsOppsRaw : [];

  // Linked-to filter search (admin)
  const { data: flLeadsRaw, isFetching: flLeadsFetching } = useQuery({
    queryKey: ["fl-leads", debouncedLTFQ, flLeadsPage, baseParams],
    queryFn: () =>
      leadsApi
        .list({
          ...(debouncedLTFQ ? { search: debouncedLTFQ } : {}),
          limit: FL_PAGE_SIZE,
          page: flLeadsPage,
          ...baseParams,
        })
        .then((r) => r.data?.data ?? []),
    enabled: showLinkedFilter && isAdmin,
    staleTime: 10_000,
  });
  useEffect(() => {
    if (!Array.isArray(flLeadsRaw) || !showLinkedFilter) return;
    setFlLeadsAll((prev) =>
      flLeadsPage === 1
        ? flLeadsRaw
        : [...prev, ...flLeadsRaw.filter((l: any) => !prev.some((p: any) => p.id === l.id))]
    );
    setFlLeadsHasMore(flLeadsRaw.length >= FL_PAGE_SIZE);
  }, [flLeadsRaw, showLinkedFilter]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (payload: any) => activitiesApi.create(payload),
    onSuccess: () => {
      toast.success("Activity logged");
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      queryClient.invalidateQueries({ queryKey: ["activities-stats"] });
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
      queryClient.invalidateQueries({ queryKey: ["activities-stats"] });
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
      nextActionDate: values.nextActionDate ? nextActionPayload(values.nextActionDate) : undefined,
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
    // Validate leadId after both are set so a "select a lead or opportunity" error clears at once
    if (type === "lead") {
      setValue("opportunityId", "");
      setValue("leadId", id, { shouldValidate: true });
    } else {
      setValue("opportunityId", id);
      setValue("leadId", "", { shouldValidate: true });
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
  const linkedToError = errors.leadId?.message as string | undefined;

  const pageTitle = isSalesUser
    ? "Activities"
    : isManager
      ? "Team activities"
      : "All Activities";
  const pageDesc = isSalesUser
    ? "Log and track every interaction with your leads and opportunities"
    : isManager
      ? "All interactions logged by your team \u2014 leads and opportunities"
      : "";

  const statCards = useMemo(() => {
    if (isSalesUser)
      return [
        {
          label: "Today",
          value: stats.today,
          sub: "activities logged",
          color: "text-slate-900 dark:text-slate-100",
          icon: Sun,
          tone: "blue",
        },
        {
          label: "This week",
          value: stats.thisWeek,
          sub: "total logged",
          color: "text-slate-900 dark:text-slate-100",
          icon: CalendarRange,
          tone: "indigo",
        },
        {
          label: "Follow-ups due",
          value: stats.followUps,
          sub: "next action today",
          color: "text-amber-400",
          icon: Clock,
          tone: "amber",
        },
        {
          label: "Overdue",
          value: stats.overdue,
          sub: "past next action date",
          color: "text-red-400",
          icon: AlertTriangle,
          tone: "rose",
        },
      ];
    if (isManager)
      return [
        {
          label: "Team today",
          value: stats.today,
          sub: "activities logged",
          color: "text-slate-900 dark:text-slate-100",
          icon: Sun,
          tone: "blue",
        },
        {
          label: "This week",
          value: stats.thisWeek,
          sub: "total team activities",
          color: "text-slate-900 dark:text-slate-100",
          icon: CalendarRange,
          tone: "indigo",
        },
        {
          label: "Overdue (team)",
          value: stats.overdue,
          sub: "needs coaching",
          color: "text-red-400",
          icon: AlertTriangle,
          tone: "rose",
        },
        {
          label: "No activity 7d+",
          value: allForStats.filter((a) => {
            const d = a.activityDate || a.createdAt;
            return d && daysSinceActivity(d) >= 7;
          }).length,
          sub: "leads going cold",
          color: "text-amber-400",
          icon: Snowflake,
          tone: "cyan",
        },
      ];
    return [
      {
        label: "System today",
        value: stats.today,
        sub: "org-wide activities",
        color: "text-slate-900 dark:text-slate-100",
        icon: Sun,
        tone: "blue",
      },
      {
        label: "This week",
        value: stats.thisWeek,
        sub: "all executives",
        color: "text-slate-900 dark:text-slate-100",
        icon: CalendarRange,
        tone: "indigo",
      },
      {
        label: "Overdue (all)",
        value: stats.overdue,
        sub: "system-wide",
        color: "text-red-400",
        icon: AlertTriangle,
        tone: "rose",
      },
      {
        label: "Total activities",
        value: stats.total,
        sub: "since go-live",
        color: "text-slate-900 dark:text-slate-100",
        icon: Layers,
        tone: "violet",
      },
    ];
  }, [isSalesUser, isManager, stats, allForStats]);

  const activeFilterChips: { key: string; label: string; onRemove: () => void }[] = [];
  if (searchText)
    activeFilterChips.push({
      key: "search",
      label: "Search: “" + searchText + "”",
      onRemove: () => { setSearchText(""); setPage(1); },
    });
  if (typeFilter)
    activeFilterChips.push({
      key: "type",
      label: "Type: " + getTypeMeta(typeFilter).label,
      onRemove: () => { setTypeFilter(""); setPage(1); },
    });
  if (dateFilter)
    activeFilterChips.push({
      key: "date",
      label: { today: "Today", week: "This week", month: "This month" }[dateFilter] ?? dateFilter,
      onRemove: () => { setDateFilter(""); setPage(1); },
    });
  if (loggedByFilter)
    activeFilterChips.push({
      key: "exec",
      label:
        "Executive: " +
        (teamMembers.find((m: any) => m.id === loggedByFilter)?.name ?? "Selected"),
      onRemove: () => { setLoggedByFilter(""); setPage(1); },
    });
  if (linkedToFilterId)
    activeFilterChips.push({
      key: "linked",
      label: "Lead: " + (linkedToFilterName || "Selected"),
      onRemove: () => {
        setLinkedToFilterId("");
        setLinkedToFilterName("");
        setLinkedToFilterQuery("");
        setPage(1);
      },
    });

  const pageSize = pagination?.limit ?? limit;
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, (page - 1) * pageSize + activities.length);
  const selectedType = watch("type");
  const showCoaching = isManager && overdueActivities.length > 0;
  const linkedSelected = !!linkedDisplay;
  const noLinkedResults =
    linkedDropOpen &&
    !!debouncedLS &&
    !lsLeadsFetching &&
    lsLeadsAll.length === 0 &&
    lsOpps.length === 0;

  return (
    <div className="space-y-6">
      {/* 1. PAGE HEADER */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-500/15 flex items-center justify-center flex-shrink-0">
            <ActivityIcon size={20} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Activity Log</p>
            <h1 className="page-title leading-tight">{pageTitle}</h1>
            {pageDesc && <p className="text-[13px] text-ink-3 mt-0.5">{pageDesc}</p>}
          </div>
        </div>
        {permissions.canLogActivity && (
          <button
            className="btn-primary h-10 justify-center whitespace-nowrap flex-shrink-0 self-start sm:self-auto"
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus size={16} /> Add Activity
          </button>
        )}
      </header>

      {/* 2. SUMMARY STATS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {statCards.map((s, i) => (
          <StatTile
            key={i}
            icon={s.icon}
            tone={s.tone}
            label={s.label}
            value={s.value}
            sub={s.sub}
            alert={s.tone === "rose" && s.value > 0}
          />
        ))}
      </div>

      {/* COACHING ALERTS — manager only */}
      {showCoaching && (
        <section className="card overflow-hidden" aria-label="Coaching alerts">
          <div className="px-4 sm:px-5 py-3.5 flex flex-wrap items-center gap-3 border-b border-line bg-amber-500/[0.04] dark:bg-amber-500/[0.05]">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="section-title flex items-center gap-2">
                Coaching alerts <CountPill tone="rose">{overdueActivities.length}</CountPill>
              </p>
              <p className="text-xs text-ink-3 mt-0.5">Overdue follow-ups across your team</p>
            </div>
            {Math.min(overdueActivities.length, 8) > 4 && (
              <button
                type="button"
                onClick={() => setShowAllAlerts((v) => !v)}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-semibold text-ink-2 hover:text-ink hover:bg-sunken dark:hover:bg-white/[0.05] transition-colors"
              >
                {showAllAlerts ? "Show less" : "Show more"}
                <ChevronDown size={13} className={cn("transition-transform", showAllAlerts && "rotate-180")} />
              </button>
            )}
          </div>
          <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
            {overdueActivities.slice(0, showAllAlerts ? 8 : 4).map((a) => {
              const linkedName =
                a.lead?.companyName ??
                a.opportunity?.opportunityName ??
                "Unknown";
              const days = daysSinceNextAction(a.nextActionDate);
              // The list endpoint returns the logger as `user`; `createdBy` kept as a fallback
              const execName = a.user?.name ?? a.createdBy?.name ?? "Unknown";
              const severe = days >= 7;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setSelectedActivity(a)}
                  className="relative w-full text-left pl-4 pr-3 py-3 rounded-xl border border-line bg-surface flex items-center gap-3 overflow-hidden hover:border-slate-300 dark:hover:border-white/20 hover:bg-sunken/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                >
                  <span className={cn("absolute left-0 top-0 bottom-0 w-[3px]", severe ? "bg-rose-500" : "bg-amber-500")} />
                  <Avatar initials={getInitials(execName)} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-ink font-semibold truncate">{execName}</p>
                    <p className="text-xs text-ink-3 truncate">
                      {getTypeMeta(activityType(a)).label} {"·"} {linkedName}
                      {a.opportunity?.opportunityName ? " (Opp)" : ""}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "text-[11px] font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0 tabular-nums",
                      severe ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                    )}
                  >
                    {days}d
                  </span>
                </button>
              );
            })}
          </div>
          {showAllAlerts && overdueActivities.length > 8 && (
            <p className="px-5 pb-3 -mt-1 text-xs text-ink-3">
              +{overdueActivities.length - 8} more overdue follow-ups
            </p>
          )}
        </section>
      )}

      <div className="grid gap-6 items-start">
        {/* 3–5. ACTIVITY LOG — toolbar, filters, list/timeline, pagination */}
        <section className="card min-w-0" aria-label="Activity log">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 pt-4 pb-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <h2 className="section-title">
                {isSalesUser ? "Recent activities" : isManager ? "All team activities" : "System-wide activity log"}
              </h2>
              <CountPill tone="blue">{total}</CountPill>
              {isFetching && !isLoading && (
                <Loader2 size={14} className="animate-spin text-ink-3" aria-label="Refreshing" />
              )}
            </div>
            {/* 3. VIEW TOGGLE */}
            <div className="inline-flex items-center p-0.5 rounded-lg bg-sunken dark:bg-white/[0.04] border border-line" role="tablist" aria-label="View mode">
              {([
                { value: "list", label: "List", icon: List },
                { value: "timeline", label: "Timeline", icon: Clock },
              ] as const).map((v) => {
                const active = viewMode === v.value;
                return (
                  <button
                    key={v.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setViewMode(v.value)}
                    className={cn(
                      "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
                      active
                        ? "bg-surface text-ink shadow-sm ring-1 ring-line"
                        : "text-ink-3 hover:text-ink",
                    )}
                  >
                    <v.icon size={13} /> {v.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. FILTERS */}
          <div className="px-4 sm:px-5 pb-4 space-y-3 border-b border-line">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[220px] sm:max-w-sm">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none"
                />
                <input
                  className="input pl-9 pr-8 h-10 py-0 text-sm"
                  placeholder="Search notes, outcome, lead or opportunity…"
                  aria-label="Search activities"
                  value={searchText}
                  onChange={(e) => {
                    setSearchText(e.target.value);
                    setPage(1);
                  }}
                />
                {searchText && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-sunken"
                    onClick={() => { setSearchText(""); setPage(1); }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Exec filter — manager and admin */}
              {!isSalesUser && teamMembers.length > 0 && (
                <Select
                  className="input h-10 py-0 text-sm w-[calc(50%-4px)] sm:w-44"
                  title="Filter by executive"
                  aria-label="Filter by executive"
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
                </Select>
              )}

              {/* Type filter — manager and admin dropdown */}
              {!isSalesUser && (
                <Select
                  className="input h-10 py-0 text-sm w-[calc(50%-4px)] sm:w-40"
                  title="Filter by type"
                  aria-label="Filter by type"
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
                </Select>
              )}

              {/* Date range — manager and admin */}
              {!isSalesUser && (
                <Select
                  className="input h-10 py-0 text-sm w-[calc(50%-4px)] sm:w-36"
                  title="Date range"
                  aria-label="Date range"
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
                </Select>
              )}

              {/* Linked-to filter — admin only */}
              {isAdmin && (
                <div className="relative w-[calc(50%-4px)] sm:w-48" ref={linkedFilterRef}>
                  <button
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={showLinkedFilter}
                    className={cn(
                      "input h-10 py-0 text-sm flex items-center gap-2 text-left cursor-pointer",
                      linkedToFilterId ? "text-blue-700 dark:text-blue-300 border-blue-500/40" : "text-ink-3",
                    )}
                    onClick={() => setShowLinkedFilter((v) => !v)}
                  >
                    <Building2 size={14} className="flex-shrink-0 opacity-70" />
                    <span className="truncate flex-1 min-w-0">
                      {linkedToFilterName || "All leads"}
                    </span>
                    {linkedToFilterId ? (
                      <X
                        size={13}
                        role="button"
                        aria-label="Clear lead filter"
                        className="text-ink-3 hover:text-rose-500 flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLinkedToFilterId("");
                          setLinkedToFilterName("");
                          setLinkedToFilterQuery("");
                          setPage(1);
                        }}
                      />
                    ) : (
                      <ChevronDown size={14} className={cn("flex-shrink-0 transition-transform", showLinkedFilter && "rotate-180")} />
                    )}
                  </button>
                  {showLinkedFilter && (
                    <div className="absolute top-full right-0 sm:left-0 sm:right-auto mt-1.5 w-[min(18rem,calc(100vw-2rem))] bg-surface border border-line rounded-xl shadow-2xl z-40 p-1.5 animate-fade-in">
                      <div className="relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
                        <input
                          autoFocus
                          className="input h-9 py-0 pl-8 text-sm"
                          placeholder="Search lead"
                          aria-label="Search lead"
                          value={linkedToFilterQuery}
                          onChange={(e) => setLinkedToFilterQuery(e.target.value)}
                        />
                      </div>
                      <div
                        className="mt-1.5 max-h-60 overflow-y-auto"
                        role="listbox"
                        onScroll={(e) => {
                          const el = e.currentTarget;
                          if (
                            flLeadsHasMore &&
                            !flLeadsFetching &&
                            el.scrollHeight - el.scrollTop <= el.clientHeight + 80
                          ) {
                            setFlLeadsPage((p) => p + 1);
                          }
                        }}
                      >
                        {flLeadsAll.map((l: any) => {
                          const sel = l.id === linkedToFilterId;
                          return (
                            <button
                              key={l.id}
                              type="button"
                              role="option"
                              aria-selected={sel}
                              className={cn(
                                "w-full flex items-center gap-2 text-left px-2.5 py-2 text-sm rounded-lg transition-colors",
                                sel
                                  ? "bg-blue-500/10 text-blue-700 dark:text-blue-300 font-medium"
                                  : "text-ink-2 hover:bg-sunken dark:hover:bg-white/[0.05]",
                              )}
                              onClick={() => {
                                setLinkedToFilterId(l.id);
                                setLinkedToFilterName(l.companyName);
                                setShowLinkedFilter(false);
                                setPage(1);
                              }}
                            >
                              <span className="truncate flex-1">{l.companyName}</span>
                              {sel && <Check size={14} className="flex-shrink-0" />}
                            </button>
                          );
                        })}
                        {flLeadsAll.length === 0 && flLeadsFetching && (
                          <p className="flex items-center justify-center gap-2 text-xs text-ink-3 px-2 py-3">
                            <Loader2 size={13} className="animate-spin" /> Loading…
                          </p>
                        )}
                        {flLeadsAll.length > 0 && flLeadsFetching && (
                          <p className="text-xs text-ink-3 px-2 py-1.5 text-center">Loading more…</p>
                        )}
                        {!flLeadsFetching && flLeadsAll.length === 0 && (
                          <p className="text-xs text-ink-3 px-2 py-3 text-center">No leads found</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Type pills — sales user only */}
            {isSalesUser && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by type">
                {[{ value: "", label: "All types" }, ...ACTIVITY_TYPES].map((t) => {
                  const active = typeFilter === t.value;
                  const TIcon = t.value ? getTypeMeta(t.value).icon : SlidersHorizontal;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setTypeFilter(t.value);
                        setPage(1);
                      }}
                      className={cn(
                        "inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
                        active
                          ? "bg-blue-600 border-blue-600 text-white shadow-sm"
                          : "bg-surface border-line text-ink-2 hover:border-slate-300 dark:hover:border-white/20 hover:text-ink",
                      )}
                    >
                      <TIcon size={12} /> {t.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Active filters */}
            {hasActiveFilters && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mr-1">Filters</span>
                {activeFilterChips.map((c) => (
                  <span
                    key={c.key}
                    className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-md bg-blue-500/[0.08] text-blue-700 dark:text-blue-300 text-xs font-medium ring-1 ring-inset ring-blue-500/20 max-w-full"
                  >
                    <span className="truncate max-w-[220px]">{c.label}</span>
                    <button
                      type="button"
                      aria-label={"Remove filter " + c.label}
                      className="w-5 h-5 rounded flex items-center justify-center hover:bg-blue-500/15"
                      onClick={c.onRemove}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  className="h-7 px-2 rounded-md text-xs font-semibold text-ink-3 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/[0.06] transition-colors"
                  onClick={clearFilters}
                >
                  Clear all
                </button>
              </div>
            )}
          </div>

          {/* 5. ACTIVITY LIST */}
          <div className="rounded-b-2xl overflow-hidden">
            {isLoading ? (
              <ActivityListSkeleton />
            ) : isError && activities.length === 0 ? (
              <EmptyState
                icon={AlertTriangle}
                title="Couldn't load activities"
                description="Something went wrong while fetching activities. Please try again."
                action={
                  <button className="btn-ghost text-xs" onClick={() => refetch()}>
                    <RefreshCw size={13} /> Retry
                  </button>
                }
              />
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
                        <Plus size={13} /> Add Activity
                      </button>
                    ) : undefined
                  }
                />
              )
            ) : viewMode === "list" ? (
              <>
              <div className={cn("hidden xl:block transition-opacity", isFetching && "opacity-70")}>
                <ActivityTable
                  activities={activities}
                  showLoggedBy={!isSalesUser}
                  canDelete={isAdmin}
                  onDelete={isAdmin ? setDeleteTarget : undefined}
                  onClick={setSelectedActivity}
                />
              </div>
              <div className={cn("xl:hidden divide-y divide-line transition-opacity", isFetching && "opacity-70")}>
                {activities.map((a) => (
                  <ActivityRow
                    key={a.id}
                    activity={a}
                    showLoggedBy={!isSalesUser}
                    canDelete={isAdmin}
                    onDelete={isAdmin ? setDeleteTarget : undefined}
                    onClick={setSelectedActivity}
                  />
                ))}
              </div>
              </>
            ) : (
              <div className={cn("px-4 sm:px-5 py-5 space-y-6 transition-opacity", isFetching && "opacity-70")}>
                {Object.entries(timelineGroups).map(([label, items]) => (
                  <div key={label}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-sunken dark:bg-white/[0.05] border border-line text-xs font-semibold text-ink whitespace-nowrap">
                        <Calendar size={11} className="text-ink-3" /> {label}
                      </span>
                      <div className="flex-1 h-px bg-line" />
                      <span className="text-[11px] text-ink-3 tabular-nums whitespace-nowrap">
                        {items.length} activit{items.length === 1 ? "y" : "ies"}
                      </span>
                    </div>
                    <div>
                      {items.map((a, idx) => (
                        <ActivityRow
                          key={a.id}
                          activity={a}
                          variant="timeline"
                          isLast={idx === items.length - 1}
                          showLoggedBy={!isSalesUser}
                          canDelete={isAdmin}
                          onDelete={isAdmin ? setDeleteTarget : undefined}
                          onClick={setSelectedActivity}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>

          {/* PAGINATION — shared component (same as the Leads page) */}
          {!isLoading && activities.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 sm:px-5 py-3 border-t border-line bg-sunken/40 dark:bg-white/[0.015] rounded-b-2xl">
              <span className="text-xs text-ink-3 tabular-nums">
                Showing <span className="font-semibold text-ink-2">{rangeStart}–{rangeEnd}</span> of{" "}
                <span className="font-semibold text-ink-2">{total}</span> activities
              </span>
              <Pagination
                page={page}
                totalPages={totalPages}
                pageSize={limit}
                onPageChange={setPage}
                onPageSizeChange={(size) => { setLimit(size); setPage(1); }}
              />
            </div>
          )}
        </section>

      </div>

      {/* 6. LOG ACTIVITY MODAL */}
      {isCreateOpen && (
        <div className={cn(OVERLAY, "z-50")} role="dialog" aria-modal="true" aria-labelledby="create-activity-title">
          <div className={cn(PANEL, "sm:max-w-2xl")}>
            <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-line">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-500/15 flex items-center justify-center flex-shrink-0">
                  <ActivityIcon size={18} />
                </div>
                <div className="min-w-0">
                  <h3 id="create-activity-title" className="font-display text-base font-semibold text-ink">
                    Add Activity
                  </h3>
                  <p className="text-xs text-ink-3 truncate">Log an interaction with a lead or opportunity</p>
                </div>
              </div>
              <button
                type="button"
                title="Close"
                aria-label="Close"
                className={ICON_BTN}
                onClick={closeForm}
                disabled={createMutation.isPending}
              >
                <X size={17} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 sm:px-6 py-5">
              <form
                id="activity-form"
                className="space-y-7"
                onSubmit={handleSubmit(onSubmit)}
              >
                <FormSection title="Activity details">
                  <div>
                    <span id="act-type-label" className="label mb-2 block">
                      Activity Type <Req />
                    </span>
                    <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-labelledby="act-type-label">
                      {ACTIVITY_TYPES.map((t) => {
                        const m = getTypeMeta(t.value);
                        const TIcon = m.icon;
                        const active = selectedType === t.value;
                        return (
                          <label
                            key={t.value}
                            className={cn(
                              "relative flex flex-col items-center justify-center gap-1.5 h-[68px] rounded-xl border cursor-pointer transition-all text-center select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500/40",
                              active
                                ? "border-blue-500 bg-blue-500/[0.06] dark:bg-blue-500/10 shadow-sm"
                                : "border-line bg-surface hover:border-slate-300 dark:hover:border-white/20 hover:bg-sunken/60",
                            )}
                          >
                            <input
                              type="radio"
                              value={t.value}
                              {...register("type")}
                              className="sr-only"
                            />
                            <span className={cn("w-7 h-7 rounded-lg flex items-center justify-center", m.bg, m.text)}>
                              <TIcon size={14} />
                            </span>
                            <span className={cn("text-[11px] font-semibold leading-none", active ? "text-ink" : "text-ink-2")}>
                              {t.label}
                            </span>
                            {active && (
                              <span className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full bg-blue-600 text-white flex items-center justify-center">
                                <Check size={9} strokeWidth={3} />
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                    <FieldError message={errors.type?.message as string} />
                  </div>

                  <div>
                    <label htmlFor="act-linked" className="label mb-1.5 block">
                      Linked To <Req />
                    </label>
                    <div className="relative" ref={linkedSearchRef}>
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none">
                        {linkedSelected ? (
                          watch("linkedToType") === "opportunity" ? <Briefcase size={14} /> : <Building2 size={14} />
                        ) : (
                          <Search size={14} />
                        )}
                      </span>
                      <input
                        id="act-linked"
                        className={cn("input pl-9 pr-16 text-sm", linkedSelected && "font-medium border-blue-500/40 bg-blue-500/[0.03]")}
                        placeholder="Search leads or opportunities"
                        autoComplete="off"
                        value={linkedDisplay || linkedSearch}
                        onChange={(e) => {
                          setLinkedSearch(e.target.value);
                          setLinkedDisplay("");
                          setValue("leadId", "");
                          setValue("opportunityId", "");
                          setLinkedDropOpen(true);
                        }}
                        onClick={() => setLinkedDropOpen((p) => !p)}
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        {linkedSelected && (
                          <span className={cn(
                            "hidden sm:inline text-[10px] px-1.5 py-px rounded font-semibold uppercase tracking-wider",
                            watch("linkedToType") === "opportunity"
                              ? "bg-violet-500/10 text-violet-700 dark:text-violet-300"
                              : "bg-blue-500/10 text-blue-700 dark:text-blue-300",
                          )}>
                            {watch("linkedToType") === "opportunity" ? "Opp" : "Lead"}
                          </span>
                        )}
                        {linkedSelected && (
                          <button
                            type="button"
                            title="Clear"
                            aria-label="Clear linked record"
                            className="w-6 h-6 rounded-md flex items-center justify-center text-ink-3 hover:text-rose-600 hover:bg-rose-500/10 transition-colors"
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
                        <button
                          type="button"
                          aria-label="Toggle results"
                          className="w-6 h-6 rounded-md flex items-center justify-center text-ink-3 hover:text-blue-600 hover:bg-blue-500/10 transition-colors"
                          onClick={() => setLinkedDropOpen((p) => !p)}
                        >
                          <ChevronDown
                            size={14}
                            className={`transition-transform duration-150 ${linkedDropOpen ? "rotate-180" : ""}`}
                          />
                        </button>
                      </div>
                      {linkedDropOpen && (lsLeadsAll.length > 0 || lsOpps.length > 0 || lsLeadsFetching || noLinkedResults) && (
                        <div
                          className="absolute top-full left-0 right-0 mt-1.5 bg-surface border border-line rounded-xl shadow-2xl z-50 max-h-64 overflow-y-auto p-1.5 animate-fade-in"
                          onScroll={(e) => {
                            const el = e.currentTarget;
                            if (
                              lsLeadsHasMore &&
                              !lsLeadsFetching &&
                              el.scrollHeight - el.scrollTop <= el.clientHeight + 80
                            ) {
                              setLsLeadsPage((p) => p + 1);
                            }
                          }}
                        >
                          {lsLeadsAll.length > 0 && (
                            <>
                              <p className="px-2.5 pt-1.5 pb-1 text-[10px] text-ink-3 font-semibold uppercase tracking-[0.12em]">
                                Leads
                              </p>
                              {lsLeadsAll.map((l: any) => (
                                <button
                                  key={l.id}
                                  type="button"
                                  className="w-full flex items-center gap-2.5 text-left px-2.5 py-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors"
                                  onClick={() =>
                                    selectLinked("lead", l.id, l.companyName)
                                  }
                                >
                                  <span className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
                                    <Building2 size={13} />
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block text-sm font-medium text-ink truncate">
                                      {l.companyName}
                                    </span>
                                    {l.contactName && (
                                      <span className="block text-[11px] text-ink-3 truncate">
                                        {l.contactName}
                                      </span>
                                    )}
                                  </span>
                                </button>
                              ))}
                              {lsLeadsFetching && (
                                <p className="px-3 py-2 text-[11px] text-ink-3 text-center">
                                  Loading more…
                                </p>
                              )}
                            </>
                          )}
                          {lsLeadsAll.length === 0 && lsLeadsFetching && (
                            <p className="flex items-center justify-center gap-2 px-3 py-3 text-xs text-ink-3">
                              <Loader2 size={13} className="animate-spin" /> Loading…
                            </p>
                          )}
                          {lsOpps.length > 0 && (
                            <>
                              <p className="px-2.5 pt-2 pb-1 text-[10px] text-ink-3 font-semibold uppercase tracking-[0.12em]">
                                Opportunities
                              </p>
                              {lsOpps.map((o: any) => (
                                <button
                                  key={o.id}
                                  type="button"
                                  className="w-full flex items-center gap-2.5 text-left px-2.5 py-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors"
                                  onClick={() =>
                                    selectLinked(
                                      "opportunity",
                                      o.id,
                                      o.opportunityName ?? o.title,
                                    )
                                  }
                                >
                                  <span className="w-7 h-7 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 flex items-center justify-center flex-shrink-0">
                                    <Briefcase size={13} />
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block text-sm font-medium text-ink truncate">
                                      {o.opportunityName ?? o.title}
                                    </span>
                                    {o.businessLine && (
                                      <span className="block text-[11px] text-ink-3 truncate">
                                        {o.businessLine}
                                      </span>
                                    )}
                                  </span>
                                </button>
                              ))}
                            </>
                          )}
                          {noLinkedResults && (
                            <p className="px-3 py-3 text-xs text-ink-3 text-center">
                              No leads or opportunities match “{debouncedLS}”
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    <FieldError message={linkedToError} />
                  </div>
                </FormSection>

                <FormSection title="Schedule">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="act-date" className="label mb-1.5 block">
                        Date <Req />
                      </label>
                      <input
                        id="act-date"
                        className="input"
                        type="date"
                        max={localDateKey()}
                        {...register("activityDate")}
                        title="Activity date"
                        onKeyDown={(e) => e.preventDefault()}
                      />
                      <FieldError message={errors.activityDate?.message as string} />
                    </div>
                    <div>
                      <label htmlFor="act-duration" className="label mb-1.5 block">Duration (mins)</label>
                      <input
                        id="act-duration"
                        className="input"
                        type="number"
                        min="1"
                        step="1"
                        placeholder="e.g. 30"
                        {...register("duration")}
                        title="Duration in minutes"
                      />
                    </div>
                    <div>
                      <label htmlFor="act-next" className="label mb-1.5 block">
                        Next Action Date <Req />
                      </label>
                      <input
                        id="act-next"
                        className="input"
                        type="date"
                        min={localDateKey()}
                        {...register("nextActionDate")}
                        title="Next action date"
                        onKeyDown={(e) => e.preventDefault()}
                      />
                      <FieldError message={errors.nextActionDate?.message as string} />
                    </div>
                  </div>
                </FormSection>

                <FormSection title="Outcome & notes">
                  <div>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <label htmlFor="act-outcome" className="label">
                        Outcome <Req />
                      </label>
                      <span className={cn("text-[11px] tabular-nums", outcome.length > 900 ? "text-amber-600 dark:text-amber-400" : "text-ink-3")}>
                        {outcome.length}/1000
                      </span>
                    </div>
                    <textarea
                      id="act-outcome"
                      className="input min-h-[96px] leading-relaxed resize-y"
                      placeholder="What happened? e.g. Client interested, wants proposal"
                      maxLength={1000}
                      {...register("outcome")}
                    />
                    <FieldError message={errors.outcome?.message as string} />
                  </div>
                  <div>
                    <label htmlFor="act-notes" className="label mb-1.5 block">Notes</label>
                    <textarea
                      id="act-notes"
                      className="input min-h-[64px] leading-relaxed resize-y"
                      rows={2}
                      placeholder="Additional context (optional)"
                      maxLength={2000}
                      {...register("notes")}
                      title="Notes"
                    />
                  </div>
                </FormSection>
              </form>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 px-5 sm:px-6 py-4 border-t border-line bg-sunken/50 dark:bg-white/[0.02]">
              <p className="hidden sm:block text-[11px] text-ink-3">
                <span className="text-rose-500">*</span> Required fields
              </p>
              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <button
                  type="button"
                  className="btn-ghost justify-center py-2.5 sm:min-w-[110px]"
                  onClick={closeForm}
                  disabled={createMutation.isPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="activity-form"
                  className="btn-primary justify-center py-2.5 sm:min-w-[150px]"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  {createMutation.isPending ? "Saving…" : "Save activity"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 7. DELETE MODAL — admin only */}
      {deleteTarget && isAdmin && (
        <DeleteModal
          activity={deleteTarget}
          isPending={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* 8. VIEW / EDIT MODAL */}
      {selectedActivity && (
        <ViewEditModal
          activity={selectedActivity}
          canEdit={isAdmin || isManager || selectedActivity.userId === currentUser?.id}
          onClose={() => setSelectedActivity(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["activities"] });
            queryClient.invalidateQueries({ queryKey: ["activities-stats"] });
          }}
        />
      )}
    </div>
  );
}
