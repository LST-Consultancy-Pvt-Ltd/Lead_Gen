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
} from "lucide-react";
import { timeAgo, getInitials } from "../../lib/utils";
import toast from "react-hot-toast";
import type { CreateActivityInput, Activity } from "../../lib/types";

interface ActivitiesListProps {
  leadId?: string;
  opportunityId?: string;
}

const activityIcons: Record<string, any> = {
  call: Phone,
  meeting: Video,
  note: FileText,
  email: Mail,
  whatsapp: MessageSquare,
};

const activityColors: Record<string, string> = {
  call: "text-blue-400 bg-blue-500/10",
  meeting: "text-purple-400 bg-purple-500/10",
  note: "text-slate-400 bg-slate-700/40",
  email: "text-amber-400 bg-amber-500/10",
  whatsapp: "text-emerald-400 bg-emerald-500/10",
};

export function ActivitiesList({ leadId, opportunityId }: ActivitiesListProps) {
  const queryClient = useQueryClient();
  const [isAddingActivity, setIsAddingActivity] = useState(false);
  const getTomorrowDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  };

  const [newActivity, setNewActivity] = useState<CreateActivityInput>({
    type: "call",
    description: "",
    outcome: "",
    nextActionDate: getTomorrowDate(),
    leadId,
    opportunityId,
  });

  // Fetch activities
  const { data, isLoading } = useQuery({
    queryKey: ["activities", leadId, opportunityId],
    queryFn: () =>
      activitiesApi.list({ leadId, opportunityId }).then((r) => r.data),
  });

  const activities = ([...(data?.data || [])] as Activity[]).sort(
    (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
  );

  // Create activity mutation
  const createMutation = useMutation({
    mutationFn: (data: CreateActivityInput) => activitiesApi.create(data),
    onSuccess: () => {
      toast.success("Activity added!");
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setIsAddingActivity(false);
      setNewActivity({
        type: "call",
        description: "",
        outcome: "",
        nextActionDate: getTomorrowDate(),
        leadId,
        opportunityId,
      });
    },
    onError: () => {
      toast.error("Failed to add activity");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newActivity.description.trim()) {
      toast.error("Description is required");
      return;
    }
    createMutation.mutate({
      ...newActivity,
      activityDate: new Date().toISOString(),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-800 dark:text-slate-200">Activity Timeline</h3>
        {!isAddingActivity && (
          <button
            onClick={() => setIsAddingActivity(true)}
            className="btn-ghost text-xs"
          >
            + Add Activity
          </button>
        )}
      </div>

      {/* Add Activity Form */}
      {isAddingActivity && (
        <form onSubmit={handleSubmit} className="card p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="activity-type" className="label text-xs">
                Type
              </label>
              <select
                id="activity-type"
                value={newActivity.type}
                onChange={(e) =>
                  setNewActivity({
                    ...newActivity,
                    type: e.target.value as any,
                  })
                }
                className="input h-9 text-xs"
              >
                <option value="call">Call</option>
                <option value="meeting">Meeting</option>
                <option value="note">Note</option>
                <option value="email">Email</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </div>
            <div>
              <label className="label text-xs">Outcome</label>
              <input
                type="text"
                value={newActivity.outcome}
                onChange={(e) =>
                  setNewActivity({ ...newActivity, outcome: e.target.value })
                }
                className="input h-9 text-xs"
                placeholder="Connected, Left VM..."
              />
            </div>
          </div>

          {/* <div>
            <label className="label text-xs">Next Action Date</label>
            <input
              type="date"
              value={newActivity.nextActionDate || ""}
              min={new Date().toISOString().split('T')[0]}
              onChange={(e) =>
                setNewActivity({ ...newActivity, nextActionDate: e.target.value })
              }
              className="input h-9 text-xs"
              required
            />
          </div> */}

          <div>
            <label className="label text-xs">Description</label>
            <textarea
              value={newActivity.description}
              onChange={(e) =>
                setNewActivity({ ...newActivity, description: e.target.value })
              }
              className="input min-h-[80px] text-xs"
              placeholder="What happened during this activity?"
              required
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIsAddingActivity(false)}
              className="btn-ghost flex-1 h-9 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex-1 h-9 text-xs"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <Spinner size={14} />
              ) : (
                "Save Activity"
              )}
            </button>
          </div>
        </form>
      )}

      {/* Activities List */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner size={20} />
        </div>
      ) : activities.length === 0 ? (
        <div className="card p-8 text-center">
          <Clock size={32} className="mx-auto mb-2 text-slate-600" />
          <p className="text-sm text-slate-500">No activities yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map((activity) => {
            const Icon = activityIcons[activity.type] || FileText;
            const colorClass =
              activityColors[activity.type] || activityColors.note;

            return (
              <div key={activity.id} className="card p-4">
                <div className="flex gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}
                  >
                    <Icon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 capitalize">
                          {activity.type}
                        </span>
                        {activity.outcome && (
                          <span className="text-xs text-slate-500">
                            • {activity.outcome}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-500 whitespace-nowrap">
                        {timeAgo(activity.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mb-2">
                      {activity.description}
                    </p>
                    {activity.createdBy && (
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Avatar
                          initials={getInitials(activity.createdBy.name)}
                          size="xs"
                        />
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
