"use client";
import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { leadsApi, usersApi } from "../../lib/api";
import { Modal, Spinner } from "../ui";
import toast from "react-hot-toast";
import type { CreateLeadInput } from "../../lib/types";

interface CreateLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const leadSources = [
  "meta_ads",
  "google_ads",
  "website_form",
  "referral",
  "cold_outreach",
  "email_campaign",
  "event",
  "webinar",
  "other",
];

export function CreateLeadModal({ isOpen, onClose }: CreateLeadModalProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<CreateLeadInput>({
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
  });

  // Fetch users for assignment dropdown
  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: () => usersApi.list().then((r) => r.data),
    enabled: isOpen,
  });

  const users = usersData?.data || [];

  const createMutation = useMutation({
    mutationFn: (data: CreateLeadInput) => leadsApi.create(data),
    onSuccess: () => {
      toast.success("Lead created successfully!");
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      onClose();
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to create lead");
    },
  });

  const resetForm = () => {
    setFormData({
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
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!formData.companyName.trim()) {
      toast.error("Company name is required");
      return;
    }

    if (!formData.contactEmail && !formData.contactPhone) {
      toast.error("Contact email or phone is required");
      return;
    }

    // Filter out empty values
    const cleanedData = Object.fromEntries(
      Object.entries(formData).filter(([_, v]) => v !== ""),
    ) as CreateLeadInput;

    createMutation.mutate(cleanedData);
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create New Lead">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Company Info */}
        <div className="space-y-3">
          <div>
            <label className="label">
              Company Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              name="companyName"
              value={formData.companyName}
              onChange={handleChange}
              className="input"
              placeholder="Acme Inc."
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Website</label>
              <input
                type="url"
                name="website"
                value={formData.website}
                onChange={handleChange}
                className="input"
                placeholder="https://example.com"
              />
            </div>
            <div>
              <label className="label">Industry</label>
              <input
                type="text"
                name="industry"
                value={formData.industry}
                onChange={handleChange}
                className="input"
                placeholder="Technology"
              />
            </div>
          </div>

          <div>
            <label className="label">Location</label>
            <input
              type="text"
              name="location"
              value={formData.location}
              onChange={handleChange}
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
              name="contactName"
              value={formData.contactName}
              onChange={handleChange}
              className="input"
              placeholder="John Doe"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                name="contactEmail"
                value={formData.contactEmail}
                onChange={handleChange}
                className="input"
                placeholder="john@example.com"
              />
            </div>
            <div>
              <label className="label">Phone</label>
              <input
                type="tel"
                name="contactPhone"
                value={formData.contactPhone}
                onChange={handleChange}
                className="input"
                placeholder="+1 (555) 123-4567"
              />
            </div>
          </div>
        </div>

        {/* Lead Details */}
        <div className="pt-3 border-t border-white/10 space-y-3">
          <h3 className="text-sm font-semibold text-slate-300">Lead Details</h3>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Source</label>
              <select
                name="source"
                value={formData.source}
                onChange={handleChange}
                className="input"
              >
                <option value="">Select source...</option>
                {leadSources.map((source) => (
                  <option key={source} value={source}>
                    {source
                      .replace(/_/g, " ")
                      .replace(/\b\w/g, (c) => c.toUpperCase())}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Assign To</label>
              <select
                name="assignedToId"
                value={formData.assignedToId}
                onChange={handleChange}
                className="input"
              >
                <option value="">Select user...</option>
                {users.map((user: any) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.role})
                  </option>
                ))}
              </select>
            </div>
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
    </Modal>
  );
}
