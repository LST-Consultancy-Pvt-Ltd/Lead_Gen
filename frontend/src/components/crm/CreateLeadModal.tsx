"use client";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { leadsApi, usersApi } from "../../lib/api";
import { Modal, Spinner } from "../ui";
import toast from "react-hot-toast";
import type { CreateLeadInput } from "../../lib/types";
import { PIPELINE_OPTIONS, LEAD_SOURCES } from "../../lib/types";
import { usePermissions } from "../../lib/rbac";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";

interface CreateLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const leadSources = LEAD_SOURCES;
const requirementTypeOptions = [
  "NetSuite Services",
  "Salesforce Services",
  "Custom Development",
  "SaaS Product",
  "Training",
];

const budgetRangeOptions = [
  "Less than $5,000",
  "$5,000 - $20,000",
  "$20,000 - $50,000",
  "$50,000 - $1,00,000",
  "Above $1,00,000",
  "Not Disclosed",
];

const timelineOptions = [
  "Immediate (within 1 month)",
  "Short-term (1-3 months)",
  "Mid-term (3-6 months)",
  "Long-term (6+ months)",
  "Exploring / No Timeline",
];

type LeadFormData = Omit<CreateLeadInput, "leadCost"> & {
  leadCost?: string;
  subSource?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  requirementType: string[];
  requirementDescription?: string;
  budgetRange: string;
  timeline?: string;
  temperature: "hot" | "warm" | "cold";
  disqualificationReason?: string;
};

const defaultValues: LeadFormData = {
  companyName: "",
  website: "",
  industry: "",
  location: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  source: "",
  assignedToId: "",
  status: "new",
  pipeline: "",
  followUpDate: "",
  leadCost: "",
  subSource: "",
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  utmContent: "",
  requirementType: [],
  requirementDescription: "",
  budgetRange: "",
  timeline: "",
  temperature: "cold",
  disqualificationReason: "",
};

export function CreateLeadModal({ isOpen, onClose }: CreateLeadModalProps) {
  const queryClient = useQueryClient();
  const { canReassignLead } = usePermissions();
  const [utmOpen, setUtmOpen] = useState(false);
  const pendingPayloadRef = useRef<(CreateLeadInput & { requirementType: string[]; budgetRange: string; temperature: "hot" | "warm" | "cold" }) | null>(null);
  const [duplicateConfirm, setDuplicateConfirm] = useState<{
    payload: CreateLeadInput & { requirementType: string[]; budgetRange: string; temperature: "hot" | "warm" | "cold" };
    companyName: string;
    existingId?: string;
  } | null>(null);

  const schema = useMemo(() => yup.object({
    companyName: yup.string().trim().required("Company name is required"),
    website: yup
      .string()
      .transform((value) => (value === '' ? undefined : value))
      .url("Enter a valid URL")
      .optional(),
    industry: yup.string().optional(),
    location: yup.string().optional(),
    contactName: yup.string().optional(),
    contactEmail: yup
      .string()
      .transform((value) => (value === '' ? undefined : value))
      .email("Enter a valid email")
      .optional(),
    contactPhone: yup.string().optional(),
    source: yup.string().required("Source is required"),
    assignedToId: yup.string().optional(),
    status: yup.string().required(),
    pipeline: yup.string().required("Pipeline is required"),
    followUpDate: yup.string().test(
      "not-past",
      "Follow-up date cannot be in the past",
      (value) => {
        if (!value) return true;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const picked = new Date(`${value}T00:00:00`);
        return picked >= today;
      },
    ).optional(),
    requirementType: yup.array().of(yup.string().required()).min(1, "Select at least one requirement type"),
    requirementDescription: yup.string().max(2000, "Requirement description must be 2000 characters or less").optional(),
    budgetRange: yup.string().required("Budget range is required"),
    timeline: yup.string().optional(),
    temperature: yup.mixed<"hot" | "warm" | "cold">().oneOf(["hot", "warm", "cold"]).required(),
    disqualificationReason: yup.string().when("status", {
      is: "disqualified",
      then: (rule) => rule.trim().min(10, "Disqualification reason must be at least 10 characters.").required("Disqualification reason is required"),
      otherwise: (rule) => rule.optional(),
    }),
    leadCost: yup.string().optional(),
    subSource: yup.string().optional(),
    utmSource: yup.string().optional(),
    utmMedium: yup.string().optional(),
    utmCampaign: yup.string().optional(),
    utmContent: yup.string().optional(),
  }).test(
    "contact-email-or-phone",
    "Contact email or phone is required",
    (value) => Boolean(value?.contactEmail?.trim() || value?.contactPhone?.trim()),
  ), []);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues,
    resolver: yupResolver(schema) as any,
    mode: "onBlur",
  });

  const status = watch("status");
  const requirementType = watch("requirementType") || [];
  const requirementDescription = watch("requirementDescription") || "";

  // Fetch users for assignment dropdown — only when canReassign
  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: () => usersApi.list().then((r) => r.data),
    enabled: isOpen && canReassignLead,
  });

  const users = usersData?.data || [];

  const createMutation = useMutation({
    mutationFn: (data: CreateLeadInput) => leadsApi.create(data),
    onSuccess: (response) => {
      const payload = response?.data?.data ?? response?.data ?? {};
      const possibleDuplicate = payload?.possibleDuplicate;
      if (possibleDuplicate) {
        setDuplicateConfirm((prev) => prev ?? {
          payload: (pendingPayloadRef.current || {}) as any,
          companyName: possibleDuplicate.companyName || pendingPayloadRef.current?.companyName || "Unknown company",
          existingId: possibleDuplicate.id,
        });
        return;
      }
      toast.success("Lead created successfully!");
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to create lead");
    },
  });

  const resetForm = () => {
    reset(defaultValues);
    setDuplicateConfirm(null);
    pendingPayloadRef.current = null;
    setUtmOpen(false);
  };

  const onSubmit = (formData: any) => {
    // Filter out empty values; exclude assignedToId when cannot reassign
    const cleanedData = Object.fromEntries(
      Object.entries(formData).filter(([k, v]) => {
        if (k === "assignedToId" && !canReassignLead) return false;
        if (k === "disqualificationReason" && formData.status !== "disqualified") return false;
        return v !== "" && v !== undefined;
      }),
    ) as unknown as CreateLeadInput & { requirementType: string[]; budgetRange: string; temperature: "hot" | "warm" | "cold" };
    // Convert leadCost to number if present
    if ((cleanedData as any).leadCost) {
      (cleanedData as any).leadCost = parseFloat((cleanedData as any).leadCost);
    }

    pendingPayloadRef.current = cleanedData;

    // Preserve payload for duplicate confirmation follow-up.
    setDuplicateConfirm({
      payload: cleanedData,
      companyName: formData.companyName,
    });

    createMutation.mutate(cleanedData);
  };

  const onInvalid = (formErrors: any) => {
    // Check named field errors first (priority order)
    const namedFieldMessage =
      formErrors?.companyName?.message ||
      formErrors?.contactEmail?.message ||
      formErrors?.contactPhone?.message ||
      formErrors?.requirementType?.message ||
      formErrors?.budgetRange?.message ||
      formErrors?.followUpDate?.message ||
      formErrors?.source?.message ||
      formErrors?.pipeline?.message ||
      formErrors?.disqualificationReason?.message;

    // Check root-level schema test errors (e.g. cross-field "contact-email-or-phone")
    // yup root tests surface under the '' (empty string) key in react-hook-form
    const rootMessage = formErrors?.['']?.message;

    // Fall back to first error found anywhere in the errors object
    const anyMessage = Object.values(formErrors).map((e: any) => e?.message).find(Boolean);

    toast.error(namedFieldMessage || rootMessage || anyMessage || "Please review the form fields and try again.");
  };

  const toggleRequirementType = (value: string) => {
    const exists = requirementType.includes(value);
    const next = exists
      ? requirementType.filter((item) => item !== value)
      : [...requirementType, value];
    setValue("requirementType", next, { shouldValidate: true, shouldDirty: true });
  };

  const handleContinueAfterDuplicate = () => {
    if (!duplicateConfirm?.payload) return;
    createMutation.mutate({ ...duplicateConfirm.payload, ignoreDuplicate: true } as any);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create New Lead">
      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-4">
        {/* Company Info */}
        <div className="space-y-3">
          <div>
            <label className="label">
              Company Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              {...register("companyName")}
              className="input"
              placeholder="Acme Inc."
            />
            {errors.companyName && <p className="text-xs text-red-400 mt-1">{errors.companyName.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Website</label>
              <input
                type="url"
                {...register("website")}
                className="input"
                placeholder="https://example.com"
              />
              {errors.website && <p className="text-xs text-red-400 mt-1">{errors.website.message}</p>}
            </div>
            <div>
              <label className="label">Industry</label>
              <input
                type="text"
                {...register("industry")}
                className="input"
                placeholder="Technology"
              />
            </div>
          </div>

          <div>
            <label className="label">Location</label>
            <input
              type="text"
              {...register("location")}
              className="input"
              placeholder="San Francisco, CA"
            />
          </div>
        </div>

        {/* Contact Info */}
        <div className="pt-3 border-t border-white/10 space-y-3">
          <h3 className="text-sm font-semibold text-slate-300">
            Contact Information
          </h3>

          <div>
            <label className="label">Contact Name</label>
            <input
              type="text"
              {...register("contactName")}
              className="input"
              placeholder="John Doe"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                {...register("contactEmail")}
                className="input"
                placeholder="john@example.com"
              />
              {errors.contactEmail && <p className="text-xs text-red-400 mt-1">{errors.contactEmail.message}</p>}
            </div>
            <div>
              <label className="label">Phone</label>
              <input
                type="tel"
                {...register("contactPhone")}
                className="input"
                placeholder="+1 (555) 123-4567"
              />
            </div>
          </div>
          <div>
            <label className="label mb-1.5 block">
              Requirement Type <span className="text-red-400">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {requirementTypeOptions.map((item) => (
                <label
                  key={item}
                  className="flex items-center gap-2 rounded-lg border border-white/10 px-2.5 py-2 text-xs text-slate-300"
                >
                  <input
                    type="checkbox"
                    checked={requirementType.includes(item)}
                    onChange={() => toggleRequirementType(item)}
                    className="w-4 h-4 rounded border-white/20 bg-slate-800 text-blue-500"
                  />
                  {item}
                </label>
              ))}
            </div>
            {errors.requirementType && <p className="text-xs text-red-400 mt-1">{errors.requirementType.message as string}</p>}
          </div>

          <div>
            <label className="label mb-1.5 block">Requirement Description</label>
            <textarea
              {...register("requirementDescription")}
              className="input min-h-[88px]"
              maxLength={2000}
              placeholder="Describe scope, goals, and constraints..."
            />
            <p className="text-[10px] text-slate-500 mt-1 text-right">
              {requirementDescription.length}/2000
            </p>
          </div>
        </div>

        {/* Lead Details */}
        <div className="pt-3 border-t border-white/10 space-y-3">
          <h3 className="text-sm font-semibold text-slate-300">Lead Details</h3>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Pipeline <span className="text-red-400">*</span></label>
              <select {...register("pipeline")} title="Pipeline" className="input">
                <option value="">Select pipeline...</option>
                {PIPELINE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {errors.pipeline && <p className="text-xs text-red-400 mt-1">{errors.pipeline.message}</p>}
            </div>
            <div>
              <label className="label">Follow-up Date</label>
              <input type="date" {...register("followUpDate")} title="Follow-up Date" placeholder="Follow-up Date" className="input" />
              {errors.followUpDate && <p className="text-xs text-red-400 mt-1">{errors.followUpDate.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Budget Range <span className="text-red-400">*</span></label>
              <select {...register("budgetRange")} title="Budget Range" className="input">
                <option value="">Select budget range...</option>
                {budgetRangeOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              {errors.budgetRange && <p className="text-xs text-red-400 mt-1">{errors.budgetRange.message}</p>}
            </div>
            <div>
              <label className="label">Timeline</label>
              <select {...register("timeline")} title="Timeline" className="input">
                <option value="">Select timeline...</option>
                {timelineOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Temperature</label>
              <select {...register("temperature")} title="Temperature" className="input">
                <option value="hot">Hot</option>
                <option value="warm">Warm</option>
                <option value="cold">Cold</option>
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select
                {...register("status")}
                title="Status"
                className="input"
              >
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="replied">Replied</option>
                <option value="meeting_booked">Meeting Booked</option>
                <option value="qualified">Qualified</option>
                <option value="disqualified">Disqualified</option>
              </select>
            </div>
          </div>

          {status === "disqualified" && (
            <div>
              <label className="label">Disqualification Reason <span className="text-red-400">*</span></label>
              <input
                type="text"
                {...register("disqualificationReason")}
                className="input"
                placeholder="Reason for disqualification"
                minLength={10}
              />
              {errors.disqualificationReason && <p className="text-xs text-red-400 mt-1">{errors.disqualificationReason.message}</p>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Source <span className="text-red-400">*</span></label>
              <select {...register("source")} title="Lead Source" className="input">
                <option value="">Select source...</option>
                {leadSources.map((source) => (
                  <option key={source} value={source}>{source}</option>
                ))}
              </select>
              {errors.source && <p className="text-xs text-red-400 mt-1">{errors.source.message}</p>}
            </div>
            <div>
              <label className="label">Sub-source / Ad Name</label>
              <input type="text" {...register("subSource")} className="input" placeholder="Campaign or ad name" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Lead Cost (optional)</label>
              <input type="number" {...register("leadCost")} className="input" placeholder="0.00" min="0" step="0.01" />
            </div>
            {canReassignLead && (
              <div>
                <label className="label">Assign To</label>
                <select {...register("assignedToId")} title="Assign To" className="input">
                  <option value="">Select user...</option>
                  {users.map((user: any) => (
                    <option key={user.id} value={user.id}>{user.name} ({user.role})</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost flex-1"
            disabled={createMutation.isPending}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary flex-1"
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <>
                <Spinner size={14} />
                Creating...
              </>
            ) : (
              "Create Lead"
            )}
          </button>
        </div>
      </form>

      {duplicateConfirm && (
        <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
          <p className="text-sm text-amber-300">
            Possible duplicate found: {duplicateConfirm.companyName}. Do you want to continue?
          </p>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              className="btn-primary"
              onClick={handleContinueAfterDuplicate}
              disabled={createMutation.isPending}
            >
              Continue
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                if (duplicateConfirm.existingId) {
                  window.location.href = `/dashboard/leads/${duplicateConfirm.existingId}`;
                  onClose();
                } else {
                  toast("Existing lead not available");
                }
              }}
            >
              View Existing
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
