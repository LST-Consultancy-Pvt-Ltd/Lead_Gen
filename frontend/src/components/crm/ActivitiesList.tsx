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
  Linkedin,
  Plus,
  X,
  Pencil,
  Trash2,
  Save,
  Loader2,
  Eye,
} from "lucide-react";
import { timeAgo, getInitials } from "../../lib/utils";
import toast from "react-hot-toast";
import type { Activity } from "../../lib/types";
import { usePermissions } from "../../lib/rbac";
import { useAuthStore } from "../../store/authStore";

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
  const { isAdmin } = usePermissions();
  const currentUser = useAuthStore((s) => s.user);

  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState(emptyForm(leadId, opportunityId));

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ type: string; outcome: string; description: string; nextActionDate: string }>({
    type: 'call', outcome: '', description: '', nextActionDate: getTomorrow(),
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

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

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => activitiesApi.update(id, data),
    onSuccess: () => {
      toast.success("Activity updated");
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      setEditingId(null);
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.message || "Failed to update activity"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => activitiesApi.delete(id),
    onSuccess: () => {
      toast.success("Activity deleted");
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      setDeletingId(null);
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.message || "Failed to delete activity"),
  });

  function startEdit(activity: Activity) {
    setEditingId(activity.id);
    setEditForm({
      type: activity.type,
      outcome: activity.outcome || '',
      description: activity.description || '',
      nextActionDate: getTomorrow(),
    });
  }

  function handleSaveEdit(id: string) {
    if (!editForm.outcome.trim() && !editForm.description.trim()) {
      toast.error("Outcome or description is required");
      return;
    }
    updateMutation.mutate({
      id,
      data: {
        type: editForm.type,
        outcome: editForm.outcome || undefined,
        description: editForm.description || editForm.outcome,
        nextActionDate: editForm.nextActionDate,
      },
    });
  }

  function handleDelete(id: string) {
    deleteMutation.mutate(id);
  }

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
            const isOwner = activity.createdById === currentUser?.id;
            const canEdit = isOwner || isAdmin;
            const isEditingThis = editingId === activity.id;
            const isDeletingThis = deletingId === activity.id;

            return (
              <div
                key={activity.id}
                className="rounded-xl border border-slate-200 dark:border-white/[0.06] p-4"
              >
                {isEditingThis ? (
                  /* ── Inline edit form ── */
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label text-xs">Activity Type</label>
                        <select
                          value={editForm.type}
                          onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value }))}
                          className="input h-9 text-xs"
                        >
                          {ACTIVITY_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label text-xs">Next Action Date</label>
                        <input
                          type="date"
                          value={editForm.nextActionDate}
                          min={getToday()}
                          onChange={(e) => setEditForm((f) => ({ ...f, nextActionDate: e.target.value }))}
                          className="input h-9 text-xs"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label text-xs">Outcome</label>
                        <textarea
                          value={editForm.outcome}
                          onChange={(e) => setEditForm((f) => ({ ...f, outcome: e.target.value }))}
                          className="input min-h-[72px] text-xs resize-none"
                          placeholder="e.g. Connected, Left voicemail…"
                        />
                      </div>
                      <div>
                        <label className="label text-xs">Notes</label>
                        <textarea
                          value={editForm.description}
                          onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                          className="input min-h-[72px] text-xs resize-none"
                          placeholder="What happened during this activity?"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="btn-primary flex-1 h-9 text-xs"
                        onClick={() => handleSaveEdit(activity.id)}
                        disabled={updateMutation.isPending}
                      >
                        {updateMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                        Save
                      </button>
                      <button
                        className="btn-ghost flex-1 h-9 text-xs"
                        onClick={() => setEditingId(null)}
                        disabled={updateMutation.isPending}
                      >
                        <X size={13} /> Cancel
                      </button>
                    </div>
                  </div>
                ) : viewingId === activity.id ? (
                  /* ── Inline view panel ── */
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                          <Icon size={15} />
                        </div>
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 capitalize">
                          {activity.type?.replace(/_/g, " ")}
                        </span>
                      </div>
                      <button className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors" onClick={() => setViewingId(null)}>
                        <X size={14} />
                      </button>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-3 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Outcome</p>
                          <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">{activity.outcome || '—'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Notes</p>
                          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{activity.description || '—'}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-white/[0.06]">
                        <div>
                          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Logged By</p>
                          <p className="text-sm text-slate-700 dark:text-slate-300">{activity.createdBy?.name || '—'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Time</p>
                          <p className="text-sm text-slate-700 dark:text-slate-300">{timeAgo(activity.createdAt)}</p>
                        </div>
                      </div>
                    </div>
                    <button className="btn-ghost w-full h-8 text-xs" onClick={() => setViewingId(null)}>
                      Close
                    </button>
                  </div>
                ) : isDeletingThis ? (
                  /* ── Delete confirmation ── */
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Are you sure you want to delete this activity?</p>
                      <div className="flex gap-2">
                        <button
                          className="btn-primary h-8 text-xs px-4 bg-red-500 hover:bg-red-600 border-red-500"
                          onClick={() => handleDelete(activity.id)}
                          disabled={deleteMutation.isPending}
                        >
                          {deleteMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
                          Yes, Delete
                        </button>
                        <button className="btn-ghost h-8 text-xs px-4" onClick={() => setDeletingId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ── Normal read-only card ── */
                  <div>
                    {/* Top row: icon + type + timestamp + action icons — all on one line */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                          <Icon size={15} />
                        </div>
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 capitalize truncate">
                          {activity.type?.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-xs text-slate-400 whitespace-nowrap">{timeAgo(activity.createdAt)}</span>
                        <button title="View details" className="p-1 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-500/10 transition-colors ml-1" onClick={() => setViewingId(activity.id)}>
                          <Eye size={12} />
                        </button>
                        {canEdit && (
                          <button title="Edit" className="p-1 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-500/10 transition-colors" onClick={() => startEdit(activity)}>
                            <Pencil size={12} />
                          </button>
                        )}
                        {canEdit && (
                          <button title="Delete" className="p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-colors" onClick={() => setDeletingId(activity.id)}>
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Outcome + Notes + creator */}
                    <div className="mt-2 space-y-1">
                      <div className="flex gap-2">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider min-w-[56px] flex-shrink-0 pt-px">Outcome</span>
                        <span className="text-xs text-slate-700 dark:text-slate-300 break-words min-w-0">{activity.outcome || '—'}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider min-w-[56px] flex-shrink-0 pt-px">Notes</span>
                        <span className="text-xs text-slate-700 dark:text-slate-300 break-words min-w-0 whitespace-pre-wrap">{activity.description || '—'}</span>
                      </div>
                      {activity.createdBy?.name && (
                        <div className="flex items-center gap-1.5 pt-1 text-xs text-slate-400">
                          <Avatar initials={getInitials(activity.createdBy.name)} size="xs" />
                          <span>{activity.createdBy.name}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
