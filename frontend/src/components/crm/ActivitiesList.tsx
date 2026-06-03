"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
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
  activityDate: "",
  duration: "",
  nextActionDate: "",
  leadId,
  opportunityId,
});

export function ActivitiesList({ leadId, opportunityId }: ActivitiesListProps) {
  const queryClient = useQueryClient();
  const { isAdmin } = usePermissions();
  const currentUser = useAuthStore((s) => s.user);

  const [isAdding, setIsAdding] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [form, setForm] = useState(emptyForm(leadId, opportunityId));

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ type: string; outcome: string; description: string; activityDate: string; duration: string; nextActionDate: string }>({
    type: 'call', outcome: '', description: '', activityDate: getToday(), duration: '', nextActionDate: getTomorrow(),
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
      type: activity.action,
      outcome: activity.outcome || '',
      description: activity.description || '',
      activityDate: activity.activityDate ? new Date(activity.activityDate).toISOString().split('T')[0] : getToday(),
      duration: activity.duration != null ? String(activity.duration) : '',
      nextActionDate: activity.nextActionDate ? new Date(activity.nextActionDate).toISOString().split('T')[0] : getTomorrow(),
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
        activityDate: editForm.activityDate ? new Date(editForm.activityDate).toISOString() : undefined,
        duration: editForm.duration ? parseInt(editForm.duration, 10) : undefined,
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
      activityDate: form.activityDate ? new Date(form.activityDate).toISOString() : new Date().toISOString(),
      duration: form.duration ? parseInt(form.duration, 10) : undefined,
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
            onClick={() => { setIsAdding(true); setForm(emptyForm(leadId, opportunityId)); setFormKey(k => k + 1); }}
            className="btn-ghost text-xs flex items-center gap-1"
          >
            <Plus size={12} /> Add Activity
          </button>
        )}
      </div>

      {/* Inline Add Form */}
      {isAdding && (
        <form
          key={formKey}
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

          {/* Row 1: Duration + Activity Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">Duration (mins)</label>
              <input
                type="number"
                min="1"
                className="input h-9 text-xs"
                placeholder="e.g. 30"
                value={form.duration}
                onChange={(e) => field("duration", e.target.value)}
              />
            </div>
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
          </div>

          {/* Row 2: Next Action Date + Activity Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">
                Next Action Date <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                value={form.nextActionDate}
                min={getToday()}
                onChange={(e) => field("nextActionDate", e.target.value)}
                onKeyDown={(e) => e.preventDefault()}
                className="input h-9 text-xs"
                required
              />
            </div>
            <div>
              <label className="label text-xs">Activity Date <span className="text-red-400">*</span></label>
              <input
                type="date"
                className="input h-9 text-xs"
                value={form.activityDate}
                max={getToday()}
                onChange={(e) => field("activityDate", e.target.value)}
                onKeyDown={(e) => e.preventDefault()}
              />
            </div>
          </div>

          {/* Row 2: Outcome */}
          <div>
            <label className="label text-xs">Outcome <span className="text-red-400">*</span></label>
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
            <label className="label text-xs">Notes/Description <span className="text-red-400">*</span></label>
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
              onClick={() => { setIsAdding(true); setForm(emptyForm(leadId, opportunityId)); setFormKey(k => k + 1); }}
              className="btn-ghost text-xs mt-3 flex items-center gap-1 mx-auto"
            >
              <Plus size={12} /> Log first activity
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/[0.06]">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-white/[0.06] bg-slate-50 dark:bg-slate-800/30">
                <th className="text-left py-2.5 px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Activity Type</th>
                <th className="text-left py-2.5 px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Activity Date</th>
                <th className="text-left py-2.5 px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Duration</th>
                <th className="text-left py-2.5 px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Next Action</th>
                <th className="text-left py-2.5 px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Outcome</th>
                <th className="text-left py-2.5 px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Notes</th>
                <th className="text-left py-2.5 px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Logged</th>
                <th className="text-left py-2.5 px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((activity) => {
                const isOwner = activity.createdById === currentUser?.id;
                const canEdit = isOwner || isAdmin;

                /* ── Old inline view/edit rows — moved to popup modals below (do not remove) ──
                const isEditingThis = editingId === activity.id;
                const isDeletingThis = deletingId === activity.id;
                if (isEditingThis || viewingId === activity.id) {
                  return (
                    <tr key={activity.id}>
                      <td colSpan={8} className="p-3">
                        {isEditingThis ? (
                          <div className="space-y-3">
                            ... inline edit form ...
                          </div>
                        ) : viewingId === activity.id ? (
                          <div className="space-y-3">
                            ... inline view panel ...
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                }
                ── end old inline code ── */

                return (
                  <tr key={activity.id} className="border-b border-slate-100 dark:border-white/[0.04] hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors last:border-0">
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800 dark:text-slate-200 capitalize whitespace-nowrap">{activity.action?.replace(/_/g, " ")}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">{activity.activityDate ? new Date(activity.activityDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                    <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">{activity.duration != null ? `${activity.duration} mins` : '—'}</td>
                    <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">{activity.nextActionDate ? new Date(activity.nextActionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                    <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {activity.outcome
                        ? <span title={activity.outcome}>{activity.outcome.length > 12 ? activity.outcome.slice(0, 12) + '…' : activity.outcome}</span>
                        : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                      {activity.description
                        ? <span title={activity.description}>{activity.description.length > 12 ? activity.description.slice(0, 12) + '…' : activity.description}</span>
                        : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">{timeAgo(activity.createdAt)}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button title="View details" className="p-1 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-500/10 transition-colors" onClick={() => setViewingId(activity.id)}>
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Activity View Modal ── */}
      {mounted && viewingId && (() => {
        const viewActivity = activities.find(a => a.id === viewingId);
        if (!viewActivity) return null;
        const ViewIcon = activityIcons[viewActivity.action] || FileText;
        const viewColorClass = activityColors[viewActivity.action] || activityColors.note;
        return createPortal(
          <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-12 pb-6 px-4 bg-black/60 overflow-y-auto">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${viewColorClass}`}>
                    <ViewIcon size={15} />
                  </div>
                  <h3 className="section-title capitalize">{viewActivity.action?.replace(/_/g, " ")}</h3>
                </div>
                <button onClick={() => setViewingId(null)}>
                  <X size={16} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: 'Activity Date',  value: viewActivity.activityDate ? new Date(viewActivity.activityDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
                  { label: 'Duration',       value: viewActivity.duration != null ? `${viewActivity.duration} mins` : '—' },
                  { label: 'Activity Type',  value: viewActivity.action?.replace(/_/g, " ") },
                  { label: 'Next Action',    value: viewActivity.nextActionDate ? new Date(viewActivity.nextActionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
                  { label: 'Logged',         value: timeAgo(viewActivity.createdAt) },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-slate-50 dark:bg-slate-950 rounded-xl p-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</p>
                    <p className="text-sm text-slate-800 dark:text-slate-200 capitalize break-words">{value || '—'}</p>
                  </div>
                ))}
                <div className="col-span-2 bg-slate-50 dark:bg-slate-950 rounded-xl p-3">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Outcome</p>
                  <p className="text-sm text-slate-800 dark:text-slate-200 break-words whitespace-pre-wrap">{viewActivity.outcome || '—'}</p>
                </div>
                <div className="col-span-2 bg-slate-50 dark:bg-slate-950 rounded-xl p-3">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Notes / Description</p>
                  <p className="text-sm text-slate-800 dark:text-slate-200 break-words whitespace-pre-wrap">{viewActivity.description || '—'}</p>
                </div>
                {viewActivity.createdBy?.name && (
                  <div className="bg-slate-50 dark:bg-slate-950 rounded-xl p-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Created By</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Avatar initials={getInitials(viewActivity.createdBy.name)} size="xs" />
                      <p className="text-sm text-slate-800 dark:text-slate-200">{viewActivity.createdBy.name}</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-4">
                <button
                  className="w-full py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors flex items-center justify-center"
                  onClick={() => setViewingId(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        , document.body);
      })()}

      {/* ── Activity Edit Modal ── */}
      {mounted && editingId && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-12 pb-6 px-4 bg-black/60 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="section-title">Edit Activity</h3>
              <button onClick={() => setEditingId(null)}>
                <X size={16} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" />
              </button>
            </div>
            <div className="space-y-3">
              {/* Row 1: Duration + Activity Type */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1 block">Duration (mins)</label>
                  <input type="number" min="1" className="input" placeholder="e.g. 30"
                    value={editForm.duration}
                    onChange={(e) => setEditForm((f) => ({ ...f, duration: e.target.value }))} />
                </div>
                <div>
                  <label className="label mb-1 block">Activity Type</label>
                  <select className="input" value={editForm.type}
                    onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value }))}>
                    {ACTIVITY_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              {/* Row 2: Next Action Date + Activity Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1 block">Next Action Date <span className="text-red-400">*</span></label>
                  <input type="date" className="input" value={editForm.nextActionDate}
                    min={getToday()}
                    onKeyDown={(e) => e.preventDefault()}
                    onChange={(e) => setEditForm((f) => ({ ...f, nextActionDate: e.target.value }))} />
                </div>
                <div>
                  <label className="label mb-1 block">Activity Date <span className="text-red-400">*</span></label>
                  <input type="date" className="input" value={editForm.activityDate}
                    max={getToday()}
                    onKeyDown={(e) => e.preventDefault()}
                    onChange={(e) => setEditForm((f) => ({ ...f, activityDate: e.target.value }))} />
                </div>
              </div>
              {/* Outcome */}
              <div>
                <label className="label mb-1 block">Outcome <span className="text-red-400">*</span></label>
                <input type="text" className="input" value={editForm.outcome}
                  onChange={(e) => setEditForm((f) => ({ ...f, outcome: e.target.value }))}
                  placeholder="e.g. Connected, Left voicemail…" />
              </div>
              {/* Notes */}
              <div>
                <label className="label mb-1 block">Notes/Description <span className="text-red-400">*</span></label>
                <textarea className="input min-h-[72px] resize-none" value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="What happened during this activity?" />
              </div>
              <div className="flex gap-2 pt-1">
                <button className="btn-ghost flex-1" onClick={() => setEditingId(null)}>Cancel</button>
                <button className="btn-primary flex-1" onClick={() => handleSaveEdit(editingId)}
                  disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      , document.body)}

      {/* ── Delete Activity Popup ── */}
      {mounted && deletingId && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-12 pb-6 px-4 bg-black/60 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <Trash2 size={20} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">Delete Activity</h3>
                <p className="text-sm text-slate-500 mt-1">Are you sure you want to delete this activity? This action cannot be undone.</p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                onClick={() => setDeletingId(null)}
              >
                No, Cancel
              </button>
              <button
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-sm font-semibold text-white transition-colors disabled:opacity-60"
                disabled={deleteMutation.isPending}
                onClick={() => handleDelete(deletingId)}
              >
                {deleteMutation.isPending ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Yes, Delete"}
              </button>
            </div>
          </div>
        </div>
      , document.body)}

    </div>
  );
}
