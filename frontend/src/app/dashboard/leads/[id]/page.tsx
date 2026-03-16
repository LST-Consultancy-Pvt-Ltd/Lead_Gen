"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { leadsApi } from "../../../../lib/api";
import { Badge, Avatar, ScoreRing, Spinner } from "../../../../components/ui";
import { getInitials, intentColors, statusColors } from "../../../../lib/utils";
import {
  ArrowLeft, Zap, Send, Loader2, RefreshCw, Globe, Mail,
  User, Linkedin, Search, CheckCircle2, XCircle, ChevronRight,
  Building2, MapPin, Users2, FileText, Phone,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import toast from "react-hot-toast";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type EnrichState =
  | { status: "idle" }
  | { status: "searching_sh" }
  | { status: "sh_found";    source: "signalhire" }
  | { status: "sh_not_found" }
  | { status: "searching_apollo" }
  | { status: "apollo_found"; source: "apollo" }
  | { status: "both_failed" };

// ─────────────────────────────────────────────────────────────────────────────
// SourceBadge
// ─────────────────────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: "signalhire" | "apollo" }) {
  return source === "signalhire" ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
      <CheckCircle2 size={9} /> SignalHire
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/25 text-violet-400">
      <CheckCircle2 size={9} /> Apollo
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EnrichPanel — the core contact enrichment UI
// Shows two explicit buttons (SignalHire + Apollo) from the start
// ─────────────────────────────────────────────────────────────────────────────

function EnrichPanel({
  enrichState,
  onSignalHire,
  onApollo,
  hasContact,
}: {
  enrichState:  EnrichState;
  onSignalHire: () => void;
  onApollo:     () => void;
  hasContact:   boolean;
}) {
  const { status } = enrichState;
  const isSHLoading     = status === "searching_sh";
  const isApolloLoading = status === "searching_apollo";
  const shDone          = status === "sh_found" || status === "sh_not_found" || status === "searching_apollo" || status === "apollo_found" || status === "both_failed";
  const apolloDone      = status === "apollo_found" || status === "both_failed";

  // Show compact "re-enrich" row when contact is already present
  if (hasContact && status === "idle") {
    return (
      <div className="flex gap-2 pt-3 border-t border-white/[0.05] mt-3">
        <button
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
          onClick={onSignalHire} disabled={isSHLoading}>
          {isSHLoading ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
          Re-search SignalHire
        </button>
        <button
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-violet-500/10 border border-violet-500/25 text-violet-400 hover:bg-violet-500/20 transition-colors"
          onClick={onApollo} disabled={isApolloLoading}>
          {isApolloLoading ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
          Re-search Apollo
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Header text ── */}
      {status === "idle" && (
        <div className="text-center py-2 space-y-1">
          <p className="text-sm text-slate-300 font-medium">Find Contact Details</p>
          <p className="text-xs text-slate-500">
            Search one or both databases to find the decision-maker's email &amp; phone
          </p>
        </div>
      )}

      {/* ── SignalHire button / result ── */}
      <div className={`rounded-xl border p-3.5 transition-all ${
        status === "sh_found"
          ? "bg-emerald-500/[0.07] border-emerald-500/25"
          : status === "sh_not_found" || (shDone && status !== "sh_found")
            ? "bg-red-500/[0.05] border-red-500/15"
            : status === "searching_sh"
              ? "bg-blue-500/[0.07] border-blue-500/25"
              : "bg-slate-950 border-white/[0.08]"
      }`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
              status === "sh_found"      ? "bg-emerald-500/20 text-emerald-400"
              : status === "sh_not_found" || (shDone && status !== "sh_found")
                ? "bg-red-500/15 text-red-400"
                : status === "searching_sh"
                  ? "bg-blue-500/20 text-blue-400"
                  : "bg-slate-800 text-slate-500"
            }`}>
              {status === "searching_sh" && <Loader2 size={12} className="animate-spin" />}
              {status === "sh_found"     && <CheckCircle2 size={12} />}
              {(status === "sh_not_found" || (shDone && status !== "sh_found" && status !== "searching_sh")) && <XCircle size={12} />}
              {(status === "idle") && "1"}
            </div>
            <div>
              <p className={`text-sm font-semibold leading-none ${
                status === "sh_found"      ? "text-emerald-300"
                : status === "sh_not_found" ? "text-slate-400"
                : status === "searching_sh" ? "text-blue-300"
                : "text-slate-200"
              }`}>SignalHire</p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                {status === "searching_sh"  ? "Searching database… (up to 40s)"
                : status === "sh_found"     ? "Contact found ✓"
                : status === "sh_not_found" ? "No contact found in database"
                : shDone && status !== "sh_found" ? "Not found"
                : "Real-time contact database"}
              </p>
            </div>
          </div>

          {(status === "idle" || status === "sh_not_found" || status === "both_failed") && (
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/25 transition-colors flex-shrink-0"
              onClick={onSignalHire} disabled={isSHLoading}>
              {isSHLoading ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
              {status === "idle" ? "Search" : "Retry"}
            </button>
          )}
          {status === "searching_sh" && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs">
              <Loader2 size={11} className="animate-spin" /> Searching…
            </div>
          )}
        </div>
      </div>

      {/* Arrow */}
      <div className="flex items-center justify-center">
        <ChevronRight size={14} className="text-slate-700 rotate-90" />
      </div>

      {/* ── Apollo button / result ── */}
      <div className={`rounded-xl border p-3.5 transition-all ${
        status === "apollo_found"
          ? "bg-violet-500/[0.07] border-violet-500/25"
          : apolloDone && status !== "apollo_found"
            ? "bg-red-500/[0.05] border-red-500/15"
            : status === "searching_apollo"
              ? "bg-blue-500/[0.07] border-blue-500/25"
              : "bg-slate-950 border-white/[0.08]"
      }`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
              status === "apollo_found"   ? "bg-violet-500/20 text-violet-400"
              : apolloDone && status !== "apollo_found"
                ? "bg-red-500/15 text-red-400"
                : status === "searching_apollo"
                  ? "bg-blue-500/20 text-blue-400"
                  : "bg-slate-800 text-slate-500"
            }`}>
              {status === "searching_apollo" && <Loader2 size={12} className="animate-spin" />}
              {status === "apollo_found"     && <CheckCircle2 size={12} />}
              {apolloDone && status !== "apollo_found" && status !== "searching_apollo" && <XCircle size={12} />}
              {(status === "idle" || status === "sh_not_found" || status === "searching_sh" || status === "sh_found") && "2"}
            </div>
            <div>
              <p className={`text-sm font-semibold leading-none ${
                status === "apollo_found"     ? "text-violet-300"
                : apolloDone && status !== "apollo_found" ? "text-slate-400"
                : status === "searching_apollo" ? "text-blue-300"
                : "text-slate-200"
              }`}>Apollo.io</p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                {status === "searching_apollo"   ? "Searching people database…"
                : status === "apollo_found"      ? "Contact found ✓"
                : status === "both_failed"       ? "No contact found"
                : "270M+ professional contacts"}
              </p>
            </div>
          </div>

          {(status === "idle" || status === "sh_not_found" || status === "both_failed") && (
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/15 border border-violet-500/25 text-violet-400 text-xs font-semibold hover:bg-violet-500/25 transition-colors flex-shrink-0"
              onClick={onApollo} disabled={isApolloLoading}>
              {isApolloLoading ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
              {status === "idle" ? "Search" : "Retry"}
            </button>
          )}
          {status === "searching_apollo" && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs">
              <Loader2 size={11} className="animate-spin" /> Searching…
            </div>
          )}
        </div>
      </div>

      {/* ── Both failed tip ── */}
      {status === "both_failed" && (
        <div className="p-3 bg-slate-900 rounded-xl border border-white/[0.06]">
          <p className="text-xs text-slate-500 text-center">
            Neither database found a contact.{" "}
            <span className="text-slate-400 font-medium">Tip:</span> Adding the Company
            LinkedIn URL above greatly improves hit rates — then retry.
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [aiTab,       setAiTab]       = useState<"analysis" | "email">("analysis");
  const [emailData,   setEmailData]   = useState<{ subject: string; body: string } | null>(null);
  const [sendLoading, setSendLoading] = useState(false);
  const [enrichState, setEnrichState] = useState<EnrichState>({ status: "idle" });
  const [editingLinkedin,  setEditingLinkedin]  = useState(false);
  const [linkedinInput,    setLinkedinInput]    = useState("");

  const { data: lead, isLoading } = useQuery({
    queryKey: ["lead", id],
    queryFn:  () => leadsApi.get(id).then(r => r.data.data),
  });

  const analyzeMutation = useMutation({
    mutationFn: () => leadsApi.analyze(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead", id] });
      toast.success("AI analysis complete");
    },
    onError: () => toast.error("Analysis failed"),
  });

  const saveLinkedinMutation = useMutation({
    mutationFn: (url: string) => leadsApi.update(id, { linkedinUrl: url }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead", id] });
      setEditingLinkedin(false);
      toast.success("Company LinkedIn URL saved");
    },
    onError: () => toast.error("Save failed"),
  });

  // ── SignalHire ────────────────────────────────────────────────────────────
  const shMutation = useMutation({
    mutationFn: () => {
      setEnrichState({ status: "searching_sh" });
      return leadsApi.enrichSignalHire(id);
    },
    onSuccess: (res) => {
      const data = res.data.data;
      if (data.found) {
        setEnrichState({ status: "sh_found", source: "signalhire" });
        qc.invalidateQueries({ queryKey: ["lead", id] });
        toast.success(`Contact found via SignalHire!`);
      } else {
        setEnrichState({ status: "sh_not_found" });
        toast("SignalHire: no contact found", { icon: "ℹ️" });
      }
    },
    onError: () => {
      setEnrichState({ status: "sh_not_found" });
      toast("SignalHire search failed", { icon: "⚠️" });
    },
  });

  // ── Apollo ────────────────────────────────────────────────────────────────
  const apolloMutation = useMutation({
    mutationFn: () => {
      setEnrichState({ status: "searching_apollo" });
      return leadsApi.enrichApollo(id);
    },
    onSuccess: (res) => {
      const data = res.data.data;
      if (data.found) {
        setEnrichState({ status: "apollo_found", source: "apollo" });
        qc.invalidateQueries({ queryKey: ["lead", id] });
        toast.success("Contact found via Apollo!");
      } else {
        setEnrichState({ status: "both_failed" });
        toast.error("Apollo: no contact found.");
      }
    },
    onError: () => {
      setEnrichState({ status: "both_failed" });
      toast.error("Apollo search failed.");
    },
  });

  const generateEmailMutation = useMutation({
    mutationFn: () => leadsApi.generateEmail(id),
    onSuccess: (res) => { setEmailData(res.data.data); setAiTab("email"); },
    onError: () => toast.error("Email generation failed"),
  });

  async function handleSend() {
    if (!emailData) return;
    setSendLoading(true);
    try {
      await leadsApi.sendOutreach(id, emailData);
      toast.success("Email sent!");
      qc.invalidateQueries({ queryKey: ["lead", id] });
    } catch { toast.error("Send failed"); }
    finally { setSendLoading(false); }
  }

  if (isLoading) return <div className="flex items-center justify-center h-64"><Spinner size={24} /></div>;
  if (!lead)     return <div className="text-slate-500 text-sm p-6">Lead not found</div>;

  const hasContact     = !!(lead.contactName || lead.contactEmail || lead.contactTitle || lead.contactLinkedin);
  const isEnriching    = shMutation.isPending || apolloMutation.isPending;
  const enrichDone     = enrichState.status === "sh_found" || enrichState.status === "apollo_found";
  const companyLinkedin = lead.linkedinUrl;

  return (
    <div className="space-y-5 max-w-5xl">
      <Link href="/dashboard/leads"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300">
        <ArrowLeft size={15} /> Back to Leads
      </Link>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="card p-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Avatar initials={getInitials(lead.companyName)} size="lg" />
          <div>
            <h1 className="font-display text-xl font-bold text-slate-100">{lead.companyName}</h1>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {lead.website && (
                <a href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-sm text-blue-400 hover:underline flex items-center gap-1">
                  <Globe size={12} /> {lead.website}
                </a>
              )}
              {companyLinkedin && (
                <a href={companyLinkedin.startsWith("http") ? companyLinkedin : `https://${companyLinkedin}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-sm text-blue-400 hover:underline flex items-center gap-1">
                  <Linkedin size={12} /> LinkedIn
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-ghost" onClick={() => analyzeMutation.mutate()}
            disabled={analyzeMutation.isPending}>
            {analyzeMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Re-analyze
          </button>
          <button className="btn-primary" onClick={() => generateEmailMutation.mutate()}
            disabled={generateEmailMutation.isPending}>
            {generateEmailMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
            AI Email
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-4 lg:col-span-2">

          {/* ── Company LinkedIn ─────────────────────────────────────────── */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="section-title">Company LinkedIn</h2>
              {!editingLinkedin && (
                <button className="btn-ghost text-xs py-1.5 px-3 flex items-center gap-1.5"
                  onClick={() => { setLinkedinInput(companyLinkedin || ""); setEditingLinkedin(true); }}>
                  {companyLinkedin ? "Edit" : <><Search size={11} /> Add LinkedIn</>}
                </button>
              )}
            </div>

            {editingLinkedin ? (
              <div className="flex items-center gap-2">
                <input className="input text-xs flex-1"
                  placeholder="https://www.linkedin.com/company/your-company"
                  value={linkedinInput} onChange={e => setLinkedinInput(e.target.value)} autoFocus />
                <button className="btn-primary text-xs py-1.5 px-3"
                  onClick={() => saveLinkedinMutation.mutate(linkedinInput)}
                  disabled={saveLinkedinMutation.isPending || !linkedinInput.trim()}>
                  {saveLinkedinMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : "Save"}
                </button>
                <button className="btn-ghost text-xs py-1.5 px-3" onClick={() => setEditingLinkedin(false)}>
                  Cancel
                </button>
              </div>
            ) : companyLinkedin ? (
              <div className="flex items-center gap-3 p-3 bg-slate-950 rounded-xl">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                  <Linkedin size={16} className="text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-400 mb-0.5">Company Page</p>
                  <a href={companyLinkedin.startsWith("http") ? companyLinkedin : `https://${companyLinkedin}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-sm text-blue-400 hover:underline truncate block">
                    {companyLinkedin.replace(/^https?:\/\/(www\.)?linkedin\.com\/company\//, '')}
                  </a>
                </div>
                <a href={companyLinkedin.startsWith("http") ? companyLinkedin : `https://${companyLinkedin}`}
                  target="_blank" rel="noopener noreferrer"
                  className="btn-ghost text-xs py-1 px-2 flex-shrink-0 flex items-center gap-1">
                  <Globe size={10} /> Open
                </a>
              </div>
            ) : (
              <div className="p-4 bg-slate-950 rounded-xl border border-dashed border-white/[0.08] text-center">
                <Linkedin size={20} className="text-slate-700 mx-auto mb-2" />
                <p className="text-xs text-slate-500 mb-1">No company LinkedIn URL yet</p>
                <p className="text-[10px] text-slate-600">
                  Adding a LinkedIn URL <strong className="text-slate-500">greatly improves</strong> hit rate in SignalHire & Apollo
                </p>
                <button className="mt-3 text-xs text-blue-400 hover:text-blue-300 underline"
                  onClick={() => { setLinkedinInput(""); setEditingLinkedin(true); }}>
                  + Add LinkedIn URL
                </button>
              </div>
            )}
          </div>

          {/* ── Contact Information ──────────────────────────────────────── */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
              <h2 className="section-title">Contact Information</h2>
              {enrichDone && (
                <SourceBadge source={(enrichState as any).source} />
              )}
            </div>

            {/* Existing contact fields */}
            {hasContact && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                {lead.contactName && (
                  <div className="bg-slate-950 rounded-xl p-3 flex items-center gap-2.5">
                    <User size={14} className="text-slate-500 flex-shrink-0" />
                    <div>
                      <p className="label mb-0.5">Name</p>
                      <p className="text-sm text-slate-200">{lead.contactName}</p>
                    </div>
                  </div>
                )}
                {lead.contactTitle && (
                  <div className="bg-slate-950 rounded-xl p-3 flex items-center gap-2.5">
                    <User size={14} className="text-slate-500 flex-shrink-0" />
                    <div>
                      <p className="label mb-0.5">Title</p>
                      <p className="text-sm text-slate-200">{lead.contactTitle}</p>
                    </div>
                  </div>
                )}
                {lead.contactEmail && (
                  <div className="bg-slate-950 rounded-xl p-3 flex items-center gap-2.5 sm:col-span-2">
                    <Mail size={14} className="text-emerald-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="label mb-0.5">Email</p>
                      <a href={`mailto:${lead.contactEmail}`}
                        className="text-sm text-emerald-400 hover:underline truncate block">
                        {lead.contactEmail}
                      </a>
                    </div>
                    <button className="btn-ghost text-xs py-1 px-2 flex-shrink-0"
                      onClick={() => { navigator.clipboard.writeText(lead.contactEmail); toast.success("Copied!"); }}>
                      Copy
                    </button>
                  </div>
                )}
                {lead.contactLinkedin && (
                  <div className="bg-slate-950 rounded-xl p-3 flex items-center gap-2.5 sm:col-span-2">
                    <Linkedin size={14} className="text-blue-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="label mb-0.5">Person LinkedIn</p>
                      <a href={lead.contactLinkedin.startsWith("http") ? lead.contactLinkedin : `https://${lead.contactLinkedin}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-sm text-blue-400 hover:underline truncate block">
                        {lead.contactLinkedin}
                      </a>
                    </div>
                    <button className="btn-ghost text-xs py-1 px-2 flex-shrink-0"
                      onClick={() => { navigator.clipboard.writeText(lead.contactLinkedin); toast.success("Copied!"); }}>
                      Copy
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Enrich panel — always shown */}
            <EnrichPanel
              enrichState={enrichState}
              onSignalHire={() => shMutation.mutate()}
              onApollo={() => apolloMutation.mutate()}
              hasContact={hasContact}
            />
          </div>

          {/* ── Company Intel ─────────────────────────────────────────────── */}
          <div className="card p-5">
            <h2 className="section-title mb-4">Company Intel</h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                ["Industry",  lead.industry,    <Building2 size={13} className="text-slate-500" />],
                ["Size",      lead.companySize, <Users2    size={13} className="text-slate-500" />],
                ["Location",  lead.location,    <MapPin    size={13} className="text-slate-500" />],
                ["Status",    <Badge color={statusColors[lead.status] ?? "gray"}>{lead.status?.replace("_", " ")}</Badge>, null],
              ].filter(([, v]) => v).map(([k, v, icon]) => (
                <div key={k as string} className="bg-slate-950 rounded-xl p-3 flex items-start gap-2">
                  {icon && <div className="mt-0.5 flex-shrink-0">{icon as any}</div>}
                  <div>
                    <p className="label mb-1">{k as string}</p>
                    <div className="text-sm text-slate-200">{v as any}</div>
                  </div>
                </div>
              ))}
            </div>
            {lead.description && (
              <div className="mt-3 p-3 bg-slate-950 rounded-xl flex items-start gap-2">
                <FileText size={13} className="text-slate-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-slate-400 leading-relaxed">{lead.description}</p>
              </div>
            )}
          </div>

          {lead.techStack?.length > 0 && (
            <div className="card p-5">
              <h2 className="section-title mb-3">Tech Stack</h2>
              <div className="flex flex-wrap gap-2">
                {lead.techStack.map((t: string) => (
                  <span key={t} className="bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg px-3 py-1.5 text-sm font-medium">{t}</span>
                ))}
              </div>
            </div>
          )}

          {lead.intentSignals?.length > 0 && (
            <div className="card p-5">
              <h2 className="section-title mb-3">Intent Signals</h2>
              <div className="space-y-2">
                {(lead.intentSignals as any[]).map((s: any, i: number) => (
                  <div key={i} className="p-3 bg-slate-950 rounded-xl border-l-2 border-blue-500/40 flex items-start gap-2.5">
                    <Zap size={13} className="text-amber-400 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-slate-300">{s.text ?? s.signalText ?? s}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right sidebar ────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="section-title mb-4">AI Scores</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">Lead Score</p>
                <ScoreRing score={lead.leadScore} size={52} />
              </div>
              <div className="border-t border-white/[0.06] pt-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Intent</p>
                  <Badge color={intentColors[lead.intentLevel] ?? "gray"}>{lead.intentLevel}</Badge>
                </div>
                <span className={`font-display text-2xl font-bold ${lead.intentScore >= 80 ? "text-emerald-400" : "text-amber-400"}`}>
                  {lead.intentScore}%
                </span>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <div className="flex gap-1 mb-4 p-1 bg-slate-950 rounded-xl">
              {(["analysis", "email"] as const).map(tab => (
                <button key={tab} onClick={() => setAiTab(tab)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${aiTab === tab ? "bg-blue-500/20 text-blue-300" : "text-slate-500 hover:text-slate-300"}`}>
                  {tab === "analysis" ? "🤖 Analysis" : "✉️ Email"}
                </button>
              ))}
            </div>

            {aiTab === "analysis" && (
              <div className="space-y-3">
                {lead.opportunity && (
                  <div className="p-3 bg-blue-500/[0.08] border border-blue-500/20 rounded-xl">
                    <p className="text-xs font-semibold text-blue-300 mb-1">Opportunity</p>
                    <p className="text-xs text-slate-300 leading-relaxed">{lead.opportunity}</p>
                  </div>
                )}
                {lead.aiPitch && (
                  <div className="p-3 bg-emerald-500/[0.06] border border-emerald-500/20 rounded-xl">
                    <p className="text-xs font-semibold text-emerald-400 mb-1">Suggested Pitch</p>
                    <p className="text-xs text-slate-300 leading-relaxed">{lead.aiPitch}</p>
                  </div>
                )}
                {!lead.aiSummary && (
                  <button className="btn-ghost w-full justify-center text-xs"
                    onClick={() => analyzeMutation.mutate()} disabled={analyzeMutation.isPending}>
                    <Zap size={13} /> Run AI Analysis
                  </button>
                )}
              </div>
            )}

            {aiTab === "email" && (
              <div className="space-y-3">
                {!lead.contactEmail && (
                  <div className="p-3 bg-amber-500/[0.08] border border-amber-500/20 rounded-xl">
                    <p className="text-xs text-amber-400">
                      ⚠ No email yet — use the{" "}
                      <button className="underline hover:text-amber-300"
                        onClick={() => { setAiTab("analysis"); }}
                        disabled={isEnriching}>
                        Contact Information
                      </button>
                      {" "}section to search SignalHire or Apollo.
                    </p>
                  </div>
                )}
                {emailData ? (
                  <>
                    <div>
                      <p className="label mb-1">Subject</p>
                      <input className="input text-xs" value={emailData.subject}
                        onChange={e => setEmailData({ ...emailData, subject: e.target.value })} />
                    </div>
                    <div>
                      <p className="label mb-1">Body</p>
                      <textarea className="input text-xs h-44 resize-none leading-relaxed"
                        value={emailData.body}
                        onChange={e => setEmailData({ ...emailData, body: e.target.value })} />
                    </div>
                    <button className="btn-primary w-full justify-center"
                      onClick={handleSend} disabled={sendLoading || !lead.contactEmail}>
                      {sendLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={13} />}
                      Send Email
                    </button>
                    {!lead.contactEmail && (
                      <p className="text-xs text-center text-slate-600">Find a contact email first</p>
                    )}
                  </>
                ) : (
                  <button className="btn-ghost w-full justify-center text-xs"
                    onClick={() => generateEmailMutation.mutate()}
                    disabled={generateEmailMutation.isPending}>
                    <Mail size={13} /> Generate AI Email
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
