"use client";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { leadsApi, usersApi, dropdownsApi } from "../../lib/api";
import { Modal, Spinner, SearchableDropdown } from "../ui";
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

const STATIC_SOURCE_OPTIONS = [...LEAD_SOURCES];
const STATIC_REQUIREMENT_TYPE_OPTIONS = [
  "NetSuite Services",
  "Salesforce Services",
  "Custom Development",
  "SaaS Product",
  "Training",
];

const STATIC_BUDGET_RANGE_OPTIONS = [
  "Less than $5,000",
  "$5,000 - $20,000",
  "$20,000 - $50,000",
  "$50,000 - $1,00,000",
  "Above $1,00,000",
  "Not Disclosed",
];

const STATIC_TIMELINE_OPTIONS = [
  "Immediate (within 1 month)",
  "Short-term (1-3 months)",
  "Mid-term (3-6 months)",
  "Long-term (6+ months)",
  "Exploring / No Timeline",
];

const STATIC_LEAD_STATUS_OPTIONS = ['hot', 'warm', 'cold', 'prospect', 'lost', 'won'];
const STATIC_STATUS_OPTIONS = ['new', 'contacted', 'replied', 'meeting_booked', 'qualified', 'disqualified'];


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
  temperature: "prospect",
  disqualificationReason: "",
};

export function CreateLeadModal({ isOpen, onClose }: CreateLeadModalProps) {
  const queryClient = useQueryClient();
  const { canReassignLead, canManageDropdowns } = usePermissions();
  const [utmOpen, setUtmOpen] = useState(false);
  const [countryCode, setCountryCode] = useState('+91');
  const pendingPayloadRef = useRef<(CreateLeadInput & { requirementType: string[]; budgetRange: string; temperature: "hot" | "warm" | "cold" | "prospect" | "lost" | "won" }) | null>(null);
  const [duplicateConfirm, setDuplicateConfirm] = useState<{
    payload: CreateLeadInput & { requirementType: string[]; budgetRange: string; temperature: string };
    companyName: string;
    existingId?: string;
  } | null>(null);

  const schema = useMemo(() => yup.object({
    companyName: yup.string().trim().required("Company name is required"),
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
      .email("Enter a valid email")
      .required("Email is required"),
    contactPhone: yup.string().optional(),
    source: yup.string().required("Source is required"),
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

  const status = watch("status");
  const requirementType = watch("requirementType") || [];
  const requirementDescription = watch("requirementDescription") || "";
  const industry = watch("industry") || "";
  const location = watch("location") || "";

  // Fetch users for assignment dropdown — only when canReassign
  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: () => usersApi.list().then((r) => r.data),
    enabled: isOpen && canReassignLead,
  });

  const users = usersData?.data || [];

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
    return items.map((item: any) => (typeof item === 'string' ? item : item.value)).filter(Boolean);
  };

  const { data: requirementTypeRaw } = useQuery({
    queryKey: ['dropdowns', 'requirement_type'],
    queryFn: () => dropdownsApi.listByCategory('requirement_type').then((r) => r.data?.data || r.data || []),
    enabled: isOpen,
  });
  const { data: pipelineRaw } = useQuery({
    queryKey: ['dropdowns', 'pipeline'],
    queryFn: () => dropdownsApi.listByCategory('pipeline').then((r) => r.data?.data || r.data || []),
    enabled: isOpen,
  });
  const { data: budgetRangeRaw } = useQuery({
    queryKey: ['dropdowns', 'budget_range'],
    queryFn: () => dropdownsApi.listByCategory('budget_range').then((r) => r.data?.data || r.data || []),
    enabled: isOpen,
  });
  const { data: timelineRaw } = useQuery({
    queryKey: ['dropdowns', 'timeline'],
    queryFn: () => dropdownsApi.listByCategory('timeline').then((r) => r.data?.data || r.data || []),
    enabled: isOpen,
  });
  const { data: leadStatusRaw } = useQuery({
    queryKey: ['dropdowns', 'lead_status'],
    queryFn: () => dropdownsApi.listByCategory('lead_status').then((r) => r.data?.data || r.data || []),
    enabled: isOpen,
  });
  const { data: statusRaw } = useQuery({
    queryKey: ['dropdowns', 'status'],
    queryFn: () => dropdownsApi.listByCategory('status').then((r) => r.data?.data || r.data || []),
    enabled: isOpen,
  });
  const { data: sourceRaw } = useQuery({
    queryKey: ['dropdowns', 'lead_source'],
    queryFn: () => dropdownsApi.listByCategory('lead_source').then((r) => r.data?.data || r.data || []),
    enabled: isOpen,
  });

  const dynamicRequirementTypeOptions = useMemo(() => {
    const vals = extractDropdownValues(requirementTypeRaw);
    return vals.length > 0 ? vals : STATIC_REQUIREMENT_TYPE_OPTIONS;
  }, [requirementTypeRaw]);

  const dynamicPipelineOptions = useMemo(() => {
    const vals = extractDropdownValues(pipelineRaw);
    return vals.length > 0
      ? vals.map((v) => ({ value: v, label: v }))
      : PIPELINE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
  }, [pipelineRaw]);

  const dynamicBudgetRangeOptions = useMemo(() => {
    const vals = extractDropdownValues(budgetRangeRaw);
    return vals.length > 0 ? vals : STATIC_BUDGET_RANGE_OPTIONS;
  }, [budgetRangeRaw]);

  const dynamicTimelineOptions = useMemo(() => {
    const vals = extractDropdownValues(timelineRaw);
    return vals.length > 0 ? vals : STATIC_TIMELINE_OPTIONS;
  }, [timelineRaw]);

  const dynamicLeadStatusOptions = useMemo(() => {
    const vals = extractDropdownValues(leadStatusRaw);
    return vals.length > 0 ? vals : STATIC_LEAD_STATUS_OPTIONS;
  }, [leadStatusRaw]);

  const dynamicStatusOptions = useMemo(() => {
    const vals = extractDropdownValues(statusRaw);
    return vals.length > 0 ? vals : STATIC_STATUS_OPTIONS;
  }, [statusRaw]);

  const dynamicSourceOptions = useMemo(() => {
    const vals = extractDropdownValues(sourceRaw);
    return vals.length > 0 ? vals : STATIC_SOURCE_OPTIONS;
  }, [sourceRaw]);

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
    setCountryCode('+91');
    setDuplicateConfirm(null);
    pendingPayloadRef.current = null;
    setUtmOpen(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const onSubmit = (formData: any) => {
    // Prepend country code to phone number if phone is provided
    if (formData.contactPhone?.trim()) {
      formData.contactPhone = countryCode + formData.contactPhone.trim();
    }
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

    pendingPayloadRef.current = cleanedData;

    // Preserve payload for duplicate confirmation follow-up.
    setDuplicateConfirm({
      payload: cleanedData,
      companyName: formData.companyName,
    });

    createMutation.mutate(cleanedData);
  };

  const onInvalid = (formErrors: any) => {
    const namedFieldMessage =
      formErrors?.companyName?.message ||
      formErrors?.contactName?.message ||
      formErrors?.contactEmail?.message ||
      formErrors?.contactPhone?.message ||
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
    <Modal isOpen={isOpen} onClose={handleClose} title="Create New Lead">
      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-4">

        {/* ── Mandatory fields (top 4) ──────────────────────────────── */}
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

          <div>
            <label className="label">
              Contact Person Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              {...register("contactName")}
              className="input"
              placeholder="John Doe"
            />
            {errors.contactName && <p className="text-xs text-red-400 mt-1">{errors.contactName.message}</p>}
          </div>

          <div>
            <label className="label">
              Email <span className="text-red-400">*</span>
            </label>
            <input
              type="email"
              {...register("contactEmail")}
              className="input"
              placeholder="john@example.com"
            />
            {errors.contactEmail && <p className="text-xs text-red-400 mt-1">{errors.contactEmail.message}</p>}
          </div>

          <div>
            <label className="label">
              Status <span className="text-red-400">*</span>
            </label>
            <select {...register("status")} title="Status" className="input">
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="qualified">Qualified</option>
              <option value="warm">Warm</option>
              <option value="hot">Hot</option>
              <option value="proposal_sent">Proposal Sent</option>
              <option value="negotiation">Negotiation</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
              <option value="on_hold">On Hold</option>
              <option value="unqualified">Unqualified</option>
            </select>
            {errors.status && <p className="text-xs text-red-400 mt-1">{errors.status.message}</p>}
          </div>
        </div>

        {/* ── Company Info ──────────────────────────────────────────── */}
        <div className="pt-3 border-t border-slate-200 dark:border-white/10 space-y-3">
          <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">Company Information</h3>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Website</label>
              <input
                type="text"
                {...register("website")}
                className="input"
                placeholder="facebook.com"
              />
              {errors.website && <p className="text-xs text-red-400 mt-1">{errors.website.message}</p>}
            </div>
            <div>
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
          </div>

          <div>
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

        {/* ── Contact Info ──────────────────────────────────────────── */}
        <div className="pt-3 border-t border-slate-200 dark:border-white/10 space-y-3">
          <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">
            Contact Information
          </h3>

          <div>
            <label className="label">Job Title / Designation</label>
            <input
              type="text"
              {...register("contactTitle")}
              className="input"
              placeholder="e.g. VP of Engineering"
            />
          </div>

          <div>
            <label className="label">Phone</label>
            <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 focus-within:ring-2 focus-within:ring-blue-500/40">
              <select
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                title="Country code"
                className="shrink-0 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm px-2 border-r border-slate-200 dark:border-white/10 focus:outline-none"
              >
                <option value="+1">+1 (US)</option>
                <option value="+44">+44 (UK)</option>
                <option value="+91">+91 (IN)</option>
                <option value="+61">+61 (AU)</option>
                <option value="+971">+971 (UAE)</option>
                <option value="+65">+65 (SG)</option>
                <option value="+49">+49 (DE)</option>
                <option value="+33">+33 (FR)</option>
                <option value="+81">+81 (JP)</option>
                <option value="+86">+86 (CN)</option>
              </select>
              <input
                type="tel"
                {...register("contactPhone")}
                className="flex-1 bg-transparent text-sm px-3 py-2.5 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none"
                placeholder="9876543210"
              />
            </div>
          </div>
        </div>

        {/* ── Requirement Info (hidden) ─────────────────────────────
        <div className="pt-3 border-t border-slate-200 dark:border-white/10 space-y-3">
          <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">Requirement</h3>
          <div>
            <label className="label mb-1.5 block">
              Requirement Type <span className="text-red-400">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {requirementTypeOptions.map((item) => (
                <label key={item} className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-white/10 px-2.5 py-2 text-xs text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={requirementType.includes(item)} onChange={() => toggleRequirementType(item)} className="w-4 h-4 rounded border-white/20 bg-slate-200 dark:bg-slate-800 text-blue-500" />
                  {item}
                </label>
              ))}
            </div>
            {errors.requirementType && <p className="text-xs text-red-400 mt-1">{errors.requirementType.message as string}</p>}
          </div>
          <div>
            <label className="label mb-1.5 block">Requirement Description</label>
            <textarea {...register("requirementDescription")} className="input min-h-[88px]" maxLength={2000} placeholder="Describe scope, goals, and constraints..." />
            <p className="text-[10px] text-slate-500 mt-1 text-right">{requirementDescription.length}/2000</p>
          </div>
        </div>
        ── End Requirement Info ── */}

        {/* Lead Details */}
        <div className="pt-3 border-t border-slate-200 dark:border-white/10 space-y-3">
          <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">Lead Details</h3>

          {/* Pipeline (hidden) ─────────────────────────────────────────
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
          ── End Pipeline ── */}

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

          {/* Budget Range + Timeline (hidden) ──────────────────────────
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Budget Range <span className="text-red-400">*</span></label>
              <select {...register("budgetRange")} title="Budget Range" className="input">
                <option value="">Select budget range...</option>
                {budgetRangeOptions.map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
              </select>
              {errors.budgetRange && <p className="text-xs text-red-400 mt-1">{errors.budgetRange.message}</p>}
            </div>
            <div>
              <label className="label">Timeline</label>
              <select {...register("timeline")} title="Timeline" className="input">
                <option value="">Select timeline...</option>
                {timelineOptions.map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
              </select>
            </div>
          </div>
          ── End Budget Range + Timeline ── */}

          {/* Intent Signal (hidden) ────────────────────────────────────
          <div>
            <label className="label">Intent Signal</label>
            <select {...register("temperature")} title="Temperature" className="input">
              <option value="hot">Hot</option>
              <option value="warm">Warm</option>
              <option value="cold">Cold</option>
              <option value="prospect">Prospect</option>
              <option value="lost">Lost</option>
              <option value="won">Won</option>
            </select>
          </div>
          ── End Intent Signal ── */}

          {/* Disqualification Reason (hidden) ──────────────────────────
          {status === "disqualified" && (
            <div>
              <label className="label">Disqualification Reason <span className="text-red-400">*</span></label>
              <input type="text" {...register("disqualificationReason")} className="input" placeholder="Reason for disqualification" minLength={10} />
              {errors.disqualificationReason && <p className="text-xs text-red-400 mt-1">{errors.disqualificationReason.message}</p>}
            </div>
          )}
          ── End Disqualification Reason ── */}

          <div>
            <label className="label">Source <span className="text-red-400">*</span></label>
            <select {...register("source")} title="Lead Source" className="input">
              <option value="">Select source...</option>
              {dynamicSourceOptions.map((source) => (
                <option key={source} value={source}>{source}</option>
              ))}
            </select>
            {errors.source && <p className="text-xs text-red-400 mt-1">{errors.source.message}</p>}
          </div>

          {/* Sub-source + Lead Cost + Assign To (hidden) ───────────────
          <div>
            <label className="label">Sub-source / Ad Name</label>
            <input type="text" {...register("subSource")} className="input" placeholder="Campaign or ad name" />
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
          ── End Sub-source + Lead Cost + Assign To ── */}
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
