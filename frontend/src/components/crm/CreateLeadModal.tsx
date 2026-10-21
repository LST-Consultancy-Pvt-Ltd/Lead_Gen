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
import { Select } from '../ui/Select';
import { assignableUsers } from "../../lib/utils";
import { loadDraft, saveDraft, clearDraft, hasDraftContent, SESSION_EXPIRED_EVENT } from "../../lib/formDraft";
import {
  Briefcase, Building2, User, BadgeCheck, Mail, Phone, Activity, Hash, CalendarClock,
  Calendar, UserCheck, UserCircle, Globe, FileText, AlertCircle, AlertTriangle, Info,
} from "lucide-react";

// ── Presentation helpers for the form ─────────────────────────────────────
const SECTION_TONES: Record<string, { chip: string; tint: string }> = {
  blue:    { chip: "from-blue-500 to-indigo-600 shadow-blue-500/30",     tint: "from-blue-50/70 dark:from-blue-500/[0.06]" },
  violet:  { chip: "from-violet-500 to-fuchsia-600 shadow-violet-500/30", tint: "from-violet-50/70 dark:from-violet-500/[0.06]" },
  amber:   { chip: "from-amber-400 to-orange-600 shadow-amber-500/30",    tint: "from-amber-50/70 dark:from-amber-500/[0.06]" },
  emerald: { chip: "from-emerald-500 to-teal-600 shadow-emerald-500/30",  tint: "from-emerald-50/70 dark:from-emerald-500/[0.06]" },
  cyan:    { chip: "from-cyan-500 to-sky-600 shadow-cyan-500/30",         tint: "from-cyan-50/70 dark:from-cyan-500/[0.06]" },
  slate:   { chip: "from-slate-500 to-slate-700 shadow-slate-500/30",     tint: "from-slate-50 dark:from-white/[0.03]" },
};

function FormSection({ icon: Icon, title, subtitle, tone = "blue", children }: {
  icon: any; title: string; subtitle?: string; tone?: string; children: React.ReactNode;
}) {
  const t = SECTION_TONES[tone] ?? SECTION_TONES.blue;
  return (
    <section className="rounded-2xl border border-line bg-white dark:bg-surface overflow-hidden">
      <div className={`flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-white/[0.05] bg-gradient-to-r ${t.tint} to-transparent`}>
        <span className={`w-8 h-8 rounded-lg bg-gradient-to-br ${t.chip} text-white shadow-md flex items-center justify-center flex-shrink-0`}>
          <Icon size={15} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink leading-tight">{title}</p>
          {subtitle && <p className="text-[11px] text-ink-3 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </section>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="label mb-1.5 flex items-center gap-1">
      {children}
      {required && <span className="text-rose-500 font-bold">*</span>}
    </label>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400 mt-1.5">
      <AlertCircle size={12} className="flex-shrink-0" /> {message}
    </p>
  );
}

// Wraps an input with a leading icon
function IconField({ icon: Icon, children }: { icon: any; children: React.ReactNode }) {
  return (
    <div className="relative">
      <Icon size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 z-10" />
      {children}
    </div>
  );
}

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
  keyword?: string;
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
  keyword: "",
};

/** Draft id for the Create Lead form (see lib/formDraft). */
export const LEAD_CREATE_DRAFT_ID = "lead-create";
// Filled automatically from dropdown defaults — on their own they are not user input
const PREFILLED_FIELDS = ["status", "source", "leadType", "industry", "location", "temperature", "pipeline", "assignedToId"];

export function CreateLeadModal({ isOpen, onClose }: CreateLeadModalProps) {
  const queryClient = useQueryClient();
  const { canReassignLead, canManageDropdowns, isAdmin, isManager } = usePermissions();
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
    keyword: yup.string().max(255).optional(),
  }), []);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    getValues,
    formState: { errors },
  } = useForm({
    defaultValues,
    resolver: yupResolver(schema) as any,
    mode: "onBlur",
  });

  // ── Draft: survive a session expiry while the form is being filled ──────
  const userId = currentUser?.id;
  const draftCheckedRef = useRef(false);

  // Restore a saved draft when the form opens (e.g. after logging back in)
  useEffect(() => {
    if (!isOpen) { draftCheckedRef.current = false; return; }
    if (draftCheckedRef.current || !userId) return;
    draftCheckedRef.current = true;
    const draft = loadDraft<LeadFormData>(userId, LEAD_CREATE_DRAFT_ID);
    if (draft && hasDraftContent(draft.values as any, PREFILLED_FIELDS)) {
      reset({ ...defaultValues, ...draft.values });
      saveDraft(userId, LEAD_CREATE_DRAFT_ID, draft.values); // restored — no longer pending
      toast.success("Restored your unsaved lead details.");
    }
  }, [isOpen, userId]);

  // Autosave while open; save immediately if the session expires (before redirect)
  useEffect(() => {
    if (!isOpen || !userId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const persist = (interrupted = false) => {
      const values = getValues();
      if (hasDraftContent(values as any, PREFILLED_FIELDS)) {
        saveDraft(userId, LEAD_CREATE_DRAFT_ID, values, { interrupted });
      } else {
        clearDraft(userId, LEAD_CREATE_DRAFT_ID);
      }
    };
    const subscription = watch(() => {
      clearTimeout(timer);
      timer = setTimeout(() => persist(), 400);
    });
    const onSessionExpired = () => {
      clearTimeout(timer);
      persist(true);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => {
      clearTimeout(timer);
      subscription.unsubscribe();
      window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    };
  }, [isOpen, userId]);

  const industry = watch("industry") || "";
  const location = watch("location") || "";

  // Fetch users for assignment dropdown
  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: () => usersApi.list().then((r) => r.data),
    enabled: isOpen,
  });

  // Admin: anyone. Manager: themselves + their own team only.
  const users = assignableUsers(usersData?.data || [], currentUser as any);

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
      clearDraft(userId, LEAD_CREATE_DRAFT_ID);
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
    clearDraft(userId, LEAD_CREATE_DRAFT_ID); // deliberate cancel discards the draft
    resetForm();
    onClose();
  };

  const onSubmit = (formData: any) => {
    // Filter out empty values; exclude assignedToId for non-admins
    const cleanedData = Object.fromEntries(
      Object.entries(formData).filter(([k, v]) => {
        if (k === "assignedToId" && !isAdmin && !isManager) return false;
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
      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-4">

        {/* Lead basics: Company Name + Lead Type */}
        <FormSection icon={Briefcase} title="Lead Basics" subtitle="Who is this lead and what kind is it?" tone="blue">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>Company Name</FieldLabel>
              <IconField icon={Building2}>
                <input type="text" {...register("companyName")} className="input pl-10" placeholder="Acme Inc." />
              </IconField>
              <FieldError message={errors.companyName?.message} />
            </div>
            <div>
              <FieldLabel required>Lead Type</FieldLabel>
              <Select {...register("leadType")} title="Lead Type" className="input">
                <option value="">Select lead type...</option>
                {leadTypeOptions.map((opt: any) => (
                  <option key={opt.id || opt.value} value={opt.value}>{opt.value}</option>
                ))}
              </Select>
              <FieldError message={errors.leadType?.message} />
            </div>
          </div>
        </FormSection>

        {/* Contact person */}
        <FormSection icon={User} title="Contact Person" subtitle="The person you'll be talking to" tone="violet">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>Contact Name</FieldLabel>
              <IconField icon={User}>
                <input type="text" {...register("contactName")} className="input pl-10" placeholder="John Doe" />
              </IconField>
              <FieldError message={errors.contactName?.message} />
            </div>
            <div>
              <FieldLabel>Designation of Contact Name</FieldLabel>
              <IconField icon={BadgeCheck}>
                <input type="text" {...register("contactTitle")} className="input pl-10" placeholder="e.g. VP of Engineering" />
              </IconField>
            </div>
            <div>
              <FieldLabel>Email</FieldLabel>
              <IconField icon={Mail}>
                <input type="email" {...register("contactEmail")} className="input pl-10" placeholder="john@example.com" />
              </IconField>
              <FieldError message={errors.contactEmail?.message} />
            </div>
            <div>
              <FieldLabel>Phone</FieldLabel>
              <IconField icon={Phone}>
                <input type="tel" {...register("contactPhone")} className="input pl-10" placeholder="+91 9876543210" />
              </IconField>
              <FieldError message={errors.contactPhone?.message} />
            </div>
          </div>
        </FormSection>

        {/* Status & source */}
        <FormSection icon={Activity} title="Status & Source" subtitle="Where the lead stands and where it came from" tone="amber">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>Lead Status</FieldLabel>
              <Select {...register("status")} title="Status" className="input">
                <option value="">Select status...</option>
                {dynamicLeadStatusOptions.map((opt) => (
                  <option key={opt} value={opt}>{formatOptionLabel(opt)}</option>
                ))}
              </Select>
              <FieldError message={errors.status?.message} />
            </div>
            <div>
              <FieldLabel>Lead Source</FieldLabel>
              <Select {...register("source")} title="Lead Source" className="input">
                <option value="">Select source...</option>
                {dynamicSourceOptions.map((source) => (
                  <option key={source} value={source}>{source}</option>
                ))}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <FieldLabel>Keyword</FieldLabel>
              <IconField icon={Hash}>
                <input type="text" {...register("keyword")} className="input pl-10" placeholder="e.g. NetSuite, SuiteCommerce" />
              </IconField>
              <FieldError message={errors.keyword?.message} />
            </div>
          </div>
        </FormSection>

        {/* Follow-up & ownership */}
        <FormSection icon={CalendarClock} title="Follow-up & Ownership" subtitle="When to follow up and who owns it" tone="emerald">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>Follow-up Date</FieldLabel>
              <IconField icon={Calendar}>
                <input
                  type="date"
                  {...register("followUpDate")}
                  title="Follow-up Date"
                  className="input pl-10"
                  min={new Date().toISOString().split('T')[0]}
                  max="2099-12-31"
                  onKeyDown={(e) => {
                    if (!/Tab|Backspace|Delete|Arrow/.test(e.key)) {
                      if (!/[\d\-\/]/.test(e.key)) e.preventDefault();
                    }
                  }}
                />
              </IconField>
              <FieldError message={errors.followUpDate?.message} />
            </div>
            {(isAdmin || isManager) && (
              <div>
                <FieldLabel>Assign Lead To</FieldLabel>
                <Select {...register("assignedToId")} title="Assign To" className="input">
                  <option value="">Select user...</option>
                  {users.map((u: any) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </Select>
              </div>
            )}
            {/* Lead Created By — read-only, always the logged-in user; server sets this automatically on create */}
            <div>
              <FieldLabel>Lead Created By</FieldLabel>
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center z-10">
                  <UserCheck size={12} />
                </span>
                <input
                  type="text"
                  value={currentUser?.name || ""}
                  disabled
                  readOnly
                  title="Lead Created By"
                  className="input pl-11 font-medium !bg-slate-50 dark:!bg-white/[0.03] cursor-not-allowed"
                />
              </div>
            </div>
          </div>
        </FormSection>

        {/* Company Info */}
        <FormSection icon={Building2} title="Company Information" subtitle="Website, industry and location" tone="cyan">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>Website</FieldLabel>
              <IconField icon={Globe}>
                <input type="text" {...register("website")} className="input pl-10" placeholder="www.abc.com" />
              </IconField>
              <FieldError message={errors.website?.message} />
            </div>
            <SearchableDropdown
              label="Industry"
              value={industry}
              onChange={(value) => setValue("industry", value, { shouldValidate: true })}
              options={industries}
              onCreateNew={isAdmin ? handleCreateIndustry : undefined}
              onEdit={isAdmin ? handleEditIndustry : undefined}
              onDelete={isAdmin ? handleDeleteIndustry : undefined}
              placeholder="Select or search industry..."
              error={errors.industry?.message}
            />
          </div>
          <SearchableDropdown
            label="Location"
            value={location}
            onChange={(value) => setValue("location", value, { shouldValidate: true })}
            options={locations}
            // Location: every role can add and edit; only admins can delete
            onCreateNew={handleCreateLocation}
            onEdit={handleEditLocation}
            onDelete={isAdmin ? handleDeleteLocation : undefined}
            placeholder="Select or search location..."
            error={errors.location?.message}
          />
        </FormSection>

        {/* Notes */}
        <FormSection icon={FileText} title="Description / Notes" subtitle="Anything your team should know" tone="slate">
          <textarea
            {...register("notes")}
            className="input min-h-[96px] resize-none leading-relaxed"
            placeholder="Add any notes or context about this lead..."
            maxLength={2000}
          />
        </FormSection>

        {duplicateConfirm && (
          <div className="rounded-2xl border border-amber-200 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-500/[0.08] p-4 animate-fade-in">
            <div className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-md shadow-amber-500/30 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={16} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
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
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="sticky bottom-0 -mx-6 -mb-6 px-6 py-4 flex gap-3 border-t border-slate-100 dark:border-white/[0.06] bg-surface/95 backdrop-blur">
          <button
            type="button"
            onClick={handleClose}
            className="btn-ghost flex-1 justify-center py-2.5"
            disabled={createMutation.isPending}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary flex-1 justify-center py-2.5"
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <>
                <Spinner size={14} />
                Creating...
              </>
            ) : (
              <>
                <UserCircle size={15} /> Create Lead
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
