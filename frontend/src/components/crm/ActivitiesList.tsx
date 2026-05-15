"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { activitiesApi } from "../../lib/api";
import { Spinner, Avatar } from "../ui";
import {
  Phone,
  Mail,
  Video,
  MessageSquare,
  FileText,
  Clock,
  RefreshCw,
  CheckSquare,
  Linkedin,
  Plus,
  X,
} from "lucide-react";
import { timeAgo, getInitials } from "../../lib/utils";
import toast from "react-hot-toast";
import type { Activity } from "../../lib/types";

interface ActivitiesListProps {
  leadId?: string;
  opportunityId?: string;
}

const ACTIVITY_TYPES = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "demo", label: "Demo" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "follow_up", label: "Follow Up" },
  { value: "note", label: "Note" },
  { value: "linkedin", label: "LinkedIn" },
];

const activityIcons: Record<string, any> = {
  call: Phone,
  meeting: Video,
  note: FileText,
  email: Mail,
  whatsapp: MessageSquare,
  follow_up: RefreshCw,
  demo: Video,
  linkedin: Linkedin,
};

const activityColors: Record<string, string> = {
  call: "text-blue-400 bg-blue-500/10",
  meeting: "text-purple-400 bg-purple-500/10",
  note: "text-slate-400 bg-slate-700/40",
  email: "text-amber-400 bg-amber-500/10",
  whatsapp: "text-emerald-400 bg-emerald-500/10",
  follow_up: "text-orange-400 bg-orange-500/10",
  demo: "text-violet-400 bg-violet-500/10",
  linkedin: "text-blue-500 bg-blue-500/10",
};

function getTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function getToday() {
  return new Date().toISOString().split("T")[0];
}

const emptyForm = (leadId?: string, opportunityId?: string) => ({
  type: "call",
  outcome: "",
  description: "",
  nextActionDate: getTomorrow(),
  leadId,
  opportunityId,
});

export function ActivitiesList({ leadId, opportunityId }: ActivitiesListProps) {
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState(emptyForm(leadId, opportunityId));

  const { data, isLoading } = useQuery({
    queryKey: ["activities", leadId, opportunityId],
    queryFn: () =>
      activitiesApi.list({ leadId, opportunityId }).then((r) => r.data),
  });

  const activities = ([...(data?.data || [])] as Activity[]).sort(
    (a, b) =>
      new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
  );

  const createMutation = useMutation({
    mutationFn: (payload: any) => activitiesApi.create(payload),
    onSuccess: () => {
      toast.success("Activity added!");
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      setIsAdding(false);
      setForm(emptyForm(leadId, opportunityId));
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.message || "Failed to add activity"),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.outcome.trim() && !form.description.trim()) {
      toast.error("Outcome or description is required");
      return;
    }
    createMutation.mutate({
      type: form.type,
      outcome: form.outcome || undefined,
      description: form.description || form.outcome,
      activityDate: new Date().toISOString(),
      nextActionDate: form.nextActionDate,
      leadId: form.leadId,
      opportunityId: form.opportunityId,
    });
  };

  const field = (key: keyof typeof form, val: string) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-800 dark:text-slate-200">
          Activity Timeline
        </h3>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="btn-ghost text-xs flex items-center gap-1"
          >
            <Plus size={12} /> Add Activity
          </button>
        )}
      </div>

      {/* Inline Add Form */}
      {isAdding && (
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-blue-500/20 bg-blue-500/[0.03] p-4 space-y-3"
        >
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Log Activity
            </p>
            <button
              type="button"
              onClick={() => { setIsAdding(false); setForm(emptyForm(leadId, opportunityId)); }}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X size={14} />
            </button>
          </div>

          {/* Row 1: Type + Next Action Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">Activity Type</label>
              <select
                value={form.type}
                onChange={(e) => field("type", e.target.value)}
                className="input h-9 text-xs"
              >
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label text-xs">
                Next Action Date <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                value={form.nextActionDate}
                min={getToday()}
                onChange={(e) => field("nextActionDate", e.target.value)}
                className="input h-9 text-xs"
                required
              />
            </div>
          </div>

          {/* Row 2: Outcome */}
          <div>
            <label className="label text-xs">Outcome</label>
            <input
              type="text"
              value={form.outcome}
              onChange={(e) => field("outcome", e.target.value)}
              className="input h-9 text-xs"
              placeholder="e.g. Connected, Left voicemail, Interested…"
            />
          </div>

          {/* Row 3: Notes / Description */}
          <div>
            <label className="label text-xs">Notes</label>
            <textarea
              value={form.description}
              onChange={(e) => field("description", e.target.value)}
              className="input min-h-[72px] text-xs resize-none"
              placeholder="What happened during this activity?"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setIsAdding(false); setForm(emptyForm(leadId, opportunityId)); }}
              className="btn-ghost flex-1 h-9 text-xs"
              disabled={createMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex-1 h-9 text-xs"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? <Spinner size={14} /> : "Save Activity"}
            </button>
          </div>
        </form>
      )}

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner size={20} />
        </div>
      ) : activities.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-white/[0.06] p-8 text-center">
          <Clock size={28} className="mx-auto mb-2 text-slate-400" />
          <p className="text-sm text-slate-500">No activities yet</p>
          {!isAdding && (
            <button
              onClick={() => setIsAdding(true)}
              className="btn-ghost text-xs mt-3 flex items-center gap-1 mx-auto"
            >
              <Plus size={12} /> Log first activity
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {activities.map((activity) => {
            const Icon = activityIcons[activity.type] || FileText;
            const colorClass = activityColors[activity.type] || activityColors.note;
            return (
              <div
                key={activity.id}
                className="rounded-xl border border-slate-200 dark:border-white/[0.06] p-4"
              >
                <div className="flex gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                    <Icon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 capitalize">
                          {activity.type?.replace(/_/g, " ")}
                        </span>
                        {activity.outcome && (
                          <span className="text-xs text-slate-500">
                            • {activity.outcome}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
                        {timeAgo(activity.createdAt)}
                      </span>
                    </div>
                    {activity.description && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        {activity.description}
                      </p>
                    )}
                    {activity.createdBy?.name && (
                      <div className="flex items-center gap-1.5 mt-1.5 text-xs text-slate-500">
                        <Avatar initials={getInitials(activity.createdBy.name)} size="xs" />
                        <span>{activity.createdBy.name}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
