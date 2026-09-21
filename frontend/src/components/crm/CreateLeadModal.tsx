"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { leadsApi, usersApi, dropdownsApi } from "../../lib/api";
import { Modal, Spinner, SearchableDropdown } from "../ui";
import toast from "react-hot-toast";
import type { CreateLeadInput } from "../../lib/types";
import { LEAD_SOURCES } from "../../lib/types";
import { usePermissions } from "../../lib/rbac";
import { useAuthStore } from "../../store/authStore";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";

interface CreateLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STATIC_SOURCE_OPTIONS = [...LEAD_SOURCES];
const STATIC_LEAD_STATUS_OPTIONS = ['hot', 'warm', 'cold', 'prospect', 'lost', 'won'];


type LeadFormData = Omit<CreateLeadInput, "leadCost" | "temperature"> & {
  leadCost?: string;
  subSource?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  contactTitle?: string;
  requirementType: string[];
  requirementDescription?: string;
  budgetRange: string;
  timeline?: string;
  temperature: string;
  disqualificationReason?: string;
  leadType?: string;
  notes?: string;
};

const defaultValues: LeadFormData = {
  companyName: "",
  website: "",
  industry: "",
  location: "",
  contactName: "",
  contactTitle: "",
  contactEmail: "",
  contactPhone: "",
  source: "",
  assignedToId: "",
  status: "",
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
  temperature: "prospect",
  disqualificationReason: "",
  leadType: undefined,
  notes: "",
};

export function CreateLeadModal({ isOpen, onClose }: CreateLeadModalProps) {
  const queryClient = useQueryClient();
  const { canReassignLead, canManageDropdowns } = usePermissions();
  const currentUser = useAuthStore((s) => s.user);
  const pendingPayloadRef = useRef<(CreateLeadInput & { requirementType: string[]; budgetRange: string; temperature: "hot" | "warm" | "cold" | "prospect" | "lost" | "won" }) | null>(null);
  const [duplicateConfirm, setDuplicateConfirm] = useState<{
    payload: CreateLeadInput & { requirementType: string[]; budgetRange: string; temperature: string };
    companyName: string;
    existingId?: string;
  } | null>(null);

  const schema = useMemo(() => yup.object({
    companyName: yup.string().trim().optional(),
    website: yup
      .string()
      .transform((value) => {
        if (!value || value.trim() === '') return undefined;
        const trimmed = value.trim();
        if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
        return trimmed;
      })
      .url("Enter a valid URL")
      .optional(),
    industry: yup.string().optional(),
    location: yup.string().optional(),
    contactName: yup.string().trim().required("Contact person name is required"),
    contactTitle: yup.string().optional(),
    contactEmail: yup
      .string()
      .trim()
      .email("Enter a valid email address")
      .optional(),
    contactPhone: yup
      .string()
      .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined))
      .matches(
        /^[+]?[0-9\s\-().]{7,20}$/,
        "Enter a valid phone number (7–20 digits)"
      )
      .optional(),
    source: yup.string().optional(),
    assignedToId: yup.string().optional(),
    status: yup.string().required("Status is required"),
    pipeline: yup.string().optional(),
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
    requirementType: yup.array().of(yup.string().required()).optional(),
    requirementDescription: yup.string().max(2000, "Requirement description must be 2000 characters or less").optional(),
    budgetRange: yup.string().optional(),
    timeline: yup.string().optional(),
    temperature: yup.string().required(),
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
    leadType: yup.string().required("Lead type is required"),
    notes: yup.string().max(4000).optional(),
  }), []);

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

  const industry = watch("industry") || "";
  const location = watch("location") || "";

  // Fetch users for assignment dropdown
  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: () => usersApi.list().then((r) => r.data),
    enabled: isOpen,
  });

  const users = usersData?.data || [];

  // Fetch lead_type options from admin dropdowns
  const { data: leadTypeRaw } = useQuery({
    queryKey: ['dropdowns', 'lead_type'],
    queryFn: () => dropdownsApi.listByCategory('lead_type').then((r) => r.data?.data || r.data || []),
    enabled: isOpen,
  });

  const leadTypeOptions: any[] = useMemo(() => {
    const items = Array.isArray(leadTypeRaw) ? leadTypeRaw : [];
    return items.length > 0 ? items : [
      { id: 'position', value: 'Services', isDefault: false },
      { id: 'product',  value: 'Product',  isDefault: false },
    ];
  }, [leadTypeRaw]);

  // Invalidate all dropdown caches when modal opens so defaults are always fresh
  useEffect(() => {
    if (isOpen) {
      queryClient.invalidateQueries({ queryKey: ['dropdowns'] });
    }
  }, [isOpen]);

  // Pre-fill default lead type when options load
  useEffect(() => {
    if (!isOpen || !leadTypeOptions.length) return;
    const currentVal = watch('leadType');
    if (!currentVal) {
      const def = leadTypeOptions.find((o: any) => o.isDefault);
      if (def) setValue('leadType', def.value);
    }
  }, [leadTypeOptions, isOpen]);

  // Fetch industry dropdown options
  const { data: industriesData, refetch: refetchIndustries } = useQuery({
    queryKey: ["dropdowns", "industry"],
    queryFn: () => dropdownsApi.listByCategory("industry").then((r) => r.data?.data || r.data || []),
    enabled: isOpen,
  });

  // Fetch location dropdown options
  const { data: locationsData, refetch: refetchLocations } = useQuery({
    queryKey: ["dropdowns", "location"],
    queryFn: () => dropdownsApi.listByCategory("location").then((r) => r.data?.data || r.data || []),
    enabled: isOpen,
  });

  // Format dropdown data with IDs
  const industries = (Array.isArray(industriesData) ? industriesData : industriesData?.items || [])
    .map((item: any) => ({
      id: item.id || item._id || item.value,
      value: item.value || item,
    }));
  
  const locations = (Array.isArray(locationsData) ? locationsData : locationsData?.items || [])
    .map((item: any) => ({
      id: item.id || item._id || item.value,
      value: item.value || item,
    }));

  // ── Dynamic field queries for Create Lead form ──────────────────────────
  const extractDropdownValues = (data: any): string[] => {
    const items = Array.isArray(data) ? data : [];
    return items
      .filter((item: any) => typeof item === 'string' || item.isActive !== false)
      .map((item: any) => (typeof item === 'string' ? item : item.value))
      .filter(Boolean);
  };

  const { data: leadStatusRaw } = useQuery({
    queryKey: ['dropdowns', 'lead_status'],
    queryFn: () => dropdownsApi.listByCategory('lead_status').then((r) => r.data?.data || r.data || []),
    enabled: isOpen,
  });
  const { data: sourceRaw } = useQuery({
    queryKey: ['dropdowns', 'lead_source'],
    queryFn: () => dropdownsApi.listByCategory('lead_source').then((r) => r.data?.data || r.data || []),
    enabled: isOpen,
  });

  const dynamicLeadStatusOptions = useMemo(() => {
    const vals = extractDropdownValues(leadStatusRaw);
    return vals.length > 0 ? vals : STATIC_LEAD_STATUS_OPTIONS;
  }, [leadStatusRaw]);

  // Pre-fill default lead status when options load
  useEffect(() => {
    const items = Array.isArray(leadStatusRaw) ? leadStatusRaw : [];
    if (!items.length) return;
    const currentVal = watch('status');
    if (!currentVal) {
      const def = items.find((o: any) => o.isDefault);
      if (def) setValue('status', def.value);
    }
  }, [leadStatusRaw]);

  const dynamicSourceOptions = useMemo(() => {
    const vals = extractDropdownValues(sourceRaw);
    return vals.length > 0 ? vals : STATIC_SOURCE_OPTIONS;
  }, [sourceRaw]);

  // Pre-fill default lead source when options load
  useEffect(() => {
    const items = Array.isArray(sourceRaw) ? sourceRaw : [];
    if (!items.length) return;
    const currentVal = watch('source');
    if (!currentVal) {
      const def = items.find((o: any) => o.isDefault);
      if (def) setValue('source', def.value);
    }
  }, [sourceRaw]);

  // Pre-fill default industry when options load
  useEffect(() => {
    const items = Array.isArray(industriesData) ? industriesData : [];
    if (!items.length) return;
    const currentVal = watch('industry');
    if (!currentVal) {
      const def = items.find((o: any) => o.isDefault);
      if (def) setValue('industry', def.value, { shouldValidate: true });
    }
  }, [industriesData]);

  // Pre-fill default location when options load
  useEffect(() => {
    const items = Array.isArray(locationsData) ? locationsData : [];
    if (!items.length) return;
    const currentVal = watch('location');
    if (!currentVal) {
      const def = items.find((o: any) => o.isDefault);
      if (def) setValue('location', def.value, { shouldValidate: true });
    }
  }, [locationsData]);

  const formatOptionLabel = (value: string) =>
    value.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  // Create new industry option
  const createIndustryMutation = useMutation({
    mutationFn: (value: string) => dropdownsApi.add({ category: "industry", value }),
    onSuccess: () => {
      refetchIndustries();
      toast.success("Industry added successfully!");
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to add industry");
    },
  });

  // Create new location option
  const createLocationMutation = useMutation({
    mutationFn: (value: string) => dropdownsApi.add({ category: "location", value }),
    onSuccess: () => {
      refetchLocations();
      toast.success("Location added successfully!");
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to add location");
    },
  });

  // Edit industry option
  const editIndustryMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => 
      dropdownsApi.update(id, { value }),
    onSuccess: () => {
      refetchIndustries();
      toast.success("Industry updated successfully!");
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to update industry");
    },
  });

  // Edit location option
  const editLocationMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => 
      dropdownsApi.update(id, { value }),
    onSuccess: () => {
      refetchLocations();
      toast.success("Location updated successfully!");
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to update location");
    },
  });

  // Delete industry option
  const deleteIndustryMutation = useMutation({
    mutationFn: (id: string) => dropdownsApi.delete(id),
    onSuccess: () => {
      refetchIndustries();
      toast.success("Industry deleted successfully!");
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to delete industry");
    },
  });

  // Delete location option
  const deleteLocationMutation = useMutation({
    mutationFn: (id: string) => dropdownsApi.delete(id),
    onSuccess: () => {
      refetchLocations();
      toast.success("Location deleted successfully!");
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to delete location");
    },
  });

  const handleCreateIndustry = async (value: string) => {
    await createIndustryMutation.mutateAsync(value);
  };

  const handleCreateLocation = async (value: string) => {
    await createLocationMutation.mutateAsync(value);
  };

  const handleEditIndustry = async (id: string, oldValue: string, newValue: string) => {
    await editIndustryMutation.mutateAsync({ id, value: newValue });
  };

  const handleEditLocation = async (id: string, oldValue: string, newValue: string) => {
    await editLocationMutation.mutateAsync({ id, value: newValue });
  };

  const handleDeleteIndustry = async (id: string, value: string) => {
    await deleteIndustryMutation.mutateAsync(id);
  };

  const handleDeleteLocation = async (id: string, value: string) => {
    await deleteLocationMutation.mutateAsync(id);
  };

  const createMutation = useMutation({
    mutationFn: (data: CreateLeadInput) => leadsApi.create(data),
    onSuccess: () => {
      toast.success("Lead created successfully!");
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
      resetForm();
    },
    onError: (error: any) => {
      const responseData = error.response?.data;
      if (error.response?.status === 409 && responseData?.possibleDuplicate) {
        setDuplicateConfirm({
          payload: (pendingPayloadRef.current || {}) as any,
          companyName: responseData.possibleDuplicate.companyName || pendingPayloadRef.current?.companyName || "Unknown company",
          existingId: responseData.possibleDuplicate.id,
        });
        return;
      }
      toast.error(responseData?.message || "Failed to create lead");
    },
  });

  const resetForm = () => {
    reset(defaultValues);
    setDuplicateConfirm(null);
    pendingPayloadRef.current = null;
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const onSubmit = (formData: any) => {
    // Filter out empty values; exclude assignedToId when cannot reassign
    const cleanedData = Object.fromEntries(
      Object.entries(formData).filter(([k, v]) => {
        if (k === "assignedToId" && !canReassignLead) return false;
        if (k === "disqualificationReason" && formData.status !== "disqualified") return false;
        return v !== "" && v !== undefined;
      }),
    ) as unknown as CreateLeadInput & { requirementType: string[]; budgetRange: string; temperature: string };
    // Convert leadCost to number if present
    if ((cleanedData as any).leadCost) {
      (cleanedData as any).leadCost = parseFloat((cleanedData as any).leadCost);
    }

    // Phone OR Email required so duplicate detection can work
    const hasEmail = !!((cleanedData as any).contactEmail?.trim());
    const hasPhone = !!((cleanedData as any).contactPhone?.trim());
    if (!hasEmail && !hasPhone) {
      toast.error("Please provide at least a Contact Email or Phone number.");
      return;
    }

    pendingPayloadRef.current = cleanedData;

    createMutation.mutate(cleanedData);
  };

  const onInvalid = (formErrors: any) => {
    const namedFieldMessage =
      formErrors?.companyName?.message ||
      formErrors?.contactName?.message ||
      formErrors?.contactEmail?.message ||
      formErrors?.contactPhone?.message ||
      formErrors?.leadType?.message ||
      formErrors?.status?.message ||
      formErrors?.requirementType?.message ||
      formErrors?.budgetRange?.message ||
      formErrors?.followUpDate?.message ||
      formErrors?.source?.message ||
      formErrors?.pipeline?.message ||
      formErrors?.disqualificationReason?.message;

    const rootMessage = formErrors?.['']?.message;
    const anyMessage = Object.values(formErrors).map((e: any) => e?.message).find(Boolean);

    toast.error(namedFieldMessage || rootMessage || anyMessage || "Please review the form fields and try again.");
  };

  const handleContinueAfterDuplicate = () => {
    if (!duplicateConfirm?.payload) return;
    createMutation.mutate({ ...duplicateConfirm.payload, ignoreDuplicate: true } as any);
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Create New Lead">
      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-3">

        {/* Row 1: Company Name + Lead Type */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Company Name</label>
            <input type="text" {...register("companyName")} className="input" placeholder="Acme Inc." />
            {errors.companyName && <p className="text-xs text-red-400 mt-1">{errors.companyName.message}</p>}
          </div>
          <div>
            <label className="label">Lead Type <span className="text-red-400">*</span></label>
            <select {...register("leadType")} title="Lead Type" className="input">
              <option value="">Select lead type...</option>
              {leadTypeOptions.map((opt: any) => (
                <option key={opt.id || opt.value} value={opt.value}>{opt.value}</option>
              ))}
            </select>
            {errors.leadType && <p className="text-xs text-red-400 mt-1">{errors.leadType.message}</p>}
          </div>
        </div>

        {/* Row 2: Contact Name + Job Title */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Contact Name <span className="text-red-400">*</span></label>
            <input type="text" {...register("contactName")} className="input" placeholder="John Doe" />
            {errors.contactName && <p className="text-xs text-red-400 mt-1">{errors.contactName.message}</p>}
          </div>
          <div>
            <label className="label">Job Title</label>
            <input type="text" {...register("contactTitle")} className="input" placeholder="e.g. VP of Engineering" />
          </div>
        </div>

        {/* Row 3: Email + Phone */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Email</label>
            <input type="email" {...register("contactEmail")} className="input" placeholder="john@example.com" />
            {errors.contactEmail && <p className="text-xs text-red-400 mt-1">{errors.contactEmail.message}</p>}
          </div>
          <div>
            <label className="label">Phone</label>
            <input type="tel" {...register("contactPhone")} className="input" placeholder="+91 9876543210" />
            {errors.contactPhone && <p className="text-xs text-red-400 mt-1">{errors.contactPhone.message}</p>}
          </div>
        </div>

        {/* Row 4: Lead Status + Lead Source */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Lead Status <span className="text-red-400">*</span></label>
            <select {...register("status")} title="Status" className="input">
              <option value="">Select status...</option>
              {dynamicLeadStatusOptions.map((opt) => (
                <option key={opt} value={opt}>{formatOptionLabel(opt)}</option>
              ))}
            </select>
            {errors.status && <p className="text-xs text-red-400 mt-1">{errors.status.message}</p>}
          </div>
          <div>
            <label className="label">Lead Source</label>
            <select {...register("source")} title="Lead Source" className="input">
              <option value="">Select source...</option>
              {dynamicSourceOptions.map((source) => (
                <option key={source} value={source}>{source}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 5: Follow-up Date + Assign To */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Follow-up Date</label>
            <input
              type="date"
              {...register("followUpDate")}
              title="Follow-up Date"
              className="input"
              min={new Date().toISOString().split('T')[0]}
              max="2099-12-31"
              onKeyDown={(e) => {
                if (!/Tab|Backspace|Delete|Arrow/.test(e.key)) {
                  if (!/[\d\-\/]/.test(e.key)) e.preventDefault();
                }
              }}
            />
            {errors.followUpDate && <p className="text-xs text-red-400 mt-1">{errors.followUpDate.message}</p>}
          </div>
          {canReassignLead && (
            <div>
              <label className="label">Assign Lead To</label>
              <select {...register("assignedToId")} title="Assign To" className="input">
                <option value="">Select user...</option>
                {users.map((u: any) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Lead Created By — read-only, always the logged-in user; server sets this automatically on create */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Lead Created By</label>
            <input
              type="text"
              value={currentUser?.name || ""}
              disabled
              readOnly
              title="Lead Created By"
              className="input opacity-70 cursor-not-allowed"
            />
          </div>
        </div>

        {/* Company Info */}
        <div className="pt-2 border-t border-slate-200 dark:border-white/10">
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Company Information</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Website</label>
              <input type="text" {...register("website")} className="input" placeholder="www.abc.com" />
              {errors.website && <p className="text-xs text-red-400 mt-1">{errors.website.message}</p>}
            </div>
            <SearchableDropdown
              label="Industry"
              value={industry}
              onChange={(value) => setValue("industry", value, { shouldValidate: true })}
              options={industries}
              onCreateNew={canManageDropdowns ? handleCreateIndustry : undefined}
              onEdit={canManageDropdowns ? handleEditIndustry : undefined}
              onDelete={canManageDropdowns ? handleDeleteIndustry : undefined}
              placeholder="Select or search industry..."
              error={errors.industry?.message}
            />
          </div>
          <div className="mt-3">
            <SearchableDropdown
              label="Location"
              value={location}
              onChange={(value) => setValue("location", value, { shouldValidate: true })}
              options={locations}
              onCreateNew={canManageDropdowns ? handleCreateLocation : undefined}
              onEdit={canManageDropdowns ? handleEditLocation : undefined}
              onDelete={canManageDropdowns ? handleDeleteLocation : undefined}
              placeholder="Select or search location..."
              error={errors.location?.message}
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="label">Description / Notes</label>
          <textarea
            {...register("notes")}
            className="input min-h-[72px] resize-none"
            placeholder="Add any notes or context about this lead..."
            maxLength={2000}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={handleClose}
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
                  handleClose();
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
