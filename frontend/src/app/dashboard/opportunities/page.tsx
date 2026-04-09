'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leadsApi, opportunitiesApi } from '../../../lib/api';
import { usePermissions } from '../../../lib/rbac';
import { Badge, Spinner } from '../../../components/ui';
import { Plus, Trash2, X, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';

const STAGES: Array<{ id: string; label: string }> = [
  { id: 'qualified', label: 'Qualified' },
  { id: 'demo', label: 'Demo' },
  { id: 'proposal', label: 'Proposal' },
  { id: 'negotiation', label: 'Negotiation' },
  { id: 'closed_won', label: 'Closed Won' },
  { id: 'closed_lost', label: 'Closed Lost' },
];

const BUSINESS_LINES = [
  { value: 'all', label: 'All' },
  { value: 'netsuite', label: 'NetSuite Services' },
  { value: 'salesforce', label: 'Salesforce Services' },
  { value: 'dev', label: 'Custom Development' },
  { value: 'saas', label: 'SaaS Product' },
  { value: 'training', label: 'Training' },
];

const businessLineBadgeColor: Record<string, string> = {
  netsuite: 'blue',
  salesforce: 'purple',
  dev: 'amber',
  saas: 'green',
  training: 'gray',
};

const LOST_CATEGORIES = [
  'Pricing',
  'Competition',
  'No Budget',
  'Not a Fit',
  'Timing',
  'Other',
];

const STUCK_DAYS_THRESHOLD = 14;

function daysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

const opportunitySchema = yup.object({
  opportunityName: yup.string().trim().required('Opportunity name is required'),
  businessLine: yup.mixed<'netsuite' | 'salesforce' | 'dev' | 'saas' | 'training'>().oneOf(['netsuite', 'salesforce', 'dev', 'saas', 'training']).required('Business line is required'),
  stage: yup.mixed<'qualified' | 'demo' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost'>().oneOf(['qualified', 'demo', 'proposal', 'negotiation', 'closed_won', 'closed_lost']).required('Stage is required'),
  dealValue: yup.number().typeError('Deal value is required').required('Deal value is required').moreThan(0, 'Deal value must be greater than 0'),
  expectedCloseDate: yup.string().required('Expected close date is required').test(
    'not-past-close-date',
    'Expected close date cannot be in the past',
    (value) => {
      if (!value) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const selected = new Date(`${value}T00:00:00`);
      return selected >= today;
    },
  ),
  leadId: yup.string().optional(),
});

const defaultOpportunityValues = {
  opportunityName: '',
  businessLine: 'netsuite',
  stage: 'qualified',
  dealValue: 0,
  expectedCloseDate: '',
  leadId: '',
};

export default function OpportunitiesPage() {
  const permissions = usePermissions();
  const queryClient = useQueryClient();
  const [businessFilter, setBusinessFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [createServerError, setCreateServerError] = useState('');
  const [reasonModal, setReasonModal] = useState<{ id: string; stage: string } | null>(null);
  const [wonLostReason, setWonLostReason] = useState('');
  const [lostReasonCategory, setLostReasonCategory] = useState('Pricing');
  const [stageConfirmModal, setStageConfirmModal] = useState<{ id: string; stage: string; message: string } | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    defaultValues: defaultOpportunityValues,
    resolver: yupResolver(opportunitySchema) as any,
    mode: 'onBlur',
  });

  const queryParams: any = {};
  if (!permissions.canViewAllOpportunities) {
    queryParams.assignedToMe = true;
  }

  const { data, isLoading } = useQuery({
    queryKey: ['opportunities', queryParams],
    queryFn: () => opportunitiesApi.list(queryParams).then(r => r.data.data),
  });

  const oppLeadsParams = permissions.canViewAllOpportunities ? { limit: 100 } : { limit: 100, assignedToMe: true };
  const { data: leadsData } = useQuery({
    queryKey: ['opportunity-lead-lookup', oppLeadsParams],
    queryFn: () => leadsApi.list(oppLeadsParams).then(r => r.data?.data ?? []),
  });

  const leads = Array.isArray(leadsData) ? leadsData : [];

  const createMutation = useMutation({
    mutationFn: (payload: any) => opportunitiesApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Opportunity created');
      setCreateOpen(false);
      setCreateServerError('');
      reset(defaultOpportunityValues);
    },
    onError: (error: any) => {
      const message = error.response?.data?.message || 'Failed to create opportunity';
      setCreateServerError(message);
      toast.error(message);
    },
  });

  const updateStageMutation = useMutation({
    mutationFn: ({ id, stage, reason }: { id: string; stage: string; reason?: string }) =>
      opportunitiesApi.update(id, { stage, wonLostReason: reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Opportunity stage updated');
      setReasonModal(null);
      setWonLostReason('');
    },
    onError: (error: any) => {
      const msg = error.response?.data?.message || 'Failed to update stage';
      toast.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => opportunitiesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Opportunity deleted');
    },
    onError: () => toast.error('Failed to delete opportunity'),
  });

  const opportunities = (data as any[]) ?? [];
  const filteredOpportunities = businessFilter === 'all'
    ? opportunities
    : opportunities.filter((opp: any) => opp.businessLine === businessFilter);

  const opportunitiesByStage = STAGES.reduce((acc, stage) => {
    acc[stage.id] = filteredOpportunities.filter((opp: any) => opp.stage === stage.id);
    return acc;
  }, {} as Record<string, any[]>);

  const formatUSD = (value: number) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

  const handleStageChange = (id: string, nextStage: string) => {
    if (nextStage === 'closed_won' || nextStage === 'closed_lost') {
      setWonLostReason('');
      setLostReasonCategory('Pricing');
      setReasonModal({ id, stage: nextStage });
      return;
    }
    if (nextStage === 'demo') {
      setStageConfirmModal({
        id,
        stage: nextStage,
        message: 'Moving to Demo requires at least 1 activity of type “Demo” on the linked lead. Have you logged it?',
      });
      return;
    }
    if (nextStage === 'proposal') {
      setStageConfirmModal({
        id,
        stage: nextStage,
        message: 'Moving to Proposal requires at least 1 “Meeting” or “Demo” activity on the linked lead. Have you logged it?',
      });
      return;
    }
    updateStageMutation.mutate({ id, stage: nextStage });
  };

  const handleCreateOpportunity = (values: any) => {
    setCreateServerError('');
    createMutation.mutate({
      opportunityName: values.opportunityName,
      businessLine: values.businessLine,
      stage: values.stage,
      dealValue: Number(values.dealValue),
      expectedCloseDate: values.expectedCloseDate,
      leadId: values.leadId || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={24} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Opportunities Pipeline</h1>
          <p className="text-sm text-slate-500 mt-1">
            {filteredOpportunities.length} opportunities
          </p>
        </div>
        {permissions.canCreateOpportunities && (
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} /> New Opportunity
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {BUSINESS_LINES.map((line) => (
          <button
            key={line.value}
            onClick={() => setBusinessFilter(line.value)}
            className={`px-3 py-1.5 rounded-lg text-xs border ${
              businessFilter === line.value
                ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                : 'bg-slate-900 border-white/10 text-slate-400 hover:border-white/20'
            }`}
          >
            {line.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-3">
        {STAGES.map((stage) => {
          const items = opportunitiesByStage[stage.id] || [];
          return (
            <div key={stage.id} className="card p-3 min-h-[420px] flex flex-col">
              <h3 className="text-sm font-semibold text-slate-200 mb-3">
                {stage.label} [{items.length}]
              </h3>
              <div className="space-y-2 overflow-y-auto pr-1">
                {items.map((opp: any) => (
                  <div key={opp.id} className="rounded-lg border border-white/10 bg-slate-950 p-3">
                    <div className="flex items-start justify-between gap-1 mb-0.5">
                      <p className="text-sm font-semibold text-slate-200">{opp.opportunityName}</p>
                      {daysSince(opp.stageChangedAt || opp.updatedAt) >= STUCK_DAYS_THRESHOLD && !['closed_won','closed_lost'].includes(opp.stage) && (
                        <span title={`Stuck in ${opp.stage} for ${daysSince(opp.stageChangedAt || opp.updatedAt)} days`}
                          className="flex-shrink-0 flex items-center gap-0.5 text-[10px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/25 px-1.5 py-0.5 rounded-full">
                          <AlertTriangle size={9} /> Stuck
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <Badge color={businessLineBadgeColor[opp.businessLine] || 'gray'}>
                        {BUSINESS_LINES.find((b) => b.value === opp.businessLine)?.label || opp.businessLine}
                      </Badge>
                      <span className="text-xs text-slate-500">{opp.probability ?? 0}%</span>
                    </div>
                    <p className="text-sm text-emerald-400 font-semibold mt-2">{formatUSD(opp.dealValue)}</p>
                    <p className="text-xs text-slate-500 mt-1">Owner: {opp.salesOwner?.name || 'Unassigned'}</p>
                    <select
                      className="input h-8 text-xs mt-2"
                      title="Change opportunity stage"
                      value={opp.stage}
                      onChange={(e) => handleStageChange(opp.id, e.target.value)}
                    >
                      {STAGES.map((s) => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                    {permissions.canDeleteOpportunities && (
                      <button
                        className="btn-ghost text-xs mt-2 w-full justify-center text-red-400 hover:text-red-300"
                        onClick={() => deleteMutation.mutate(opp.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 w-full max-w-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="section-title">Create Opportunity</h3>
              <button className="text-slate-500 hover:text-slate-300" onClick={() => setCreateOpen(false)} title="Close create opportunity modal">
                <X size={16} />
              </button>
            </div>
            <form
              className="space-y-3"
              onSubmit={handleSubmit(handleCreateOpportunity)}
            >
              <div>
                <label className="label mb-1 block">Opportunity Name</label>
                <input
                  className="input"
                  title="Opportunity name"
                  {...register('opportunityName')}
                />
                {errors.opportunityName && <p className="text-xs text-red-400 mt-1">{errors.opportunityName.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1 block">Business Line</label>
                  <select
                    className="input"
                    title="Business line"
                    {...register('businessLine')}
                  >
                    {BUSINESS_LINES.filter((b) => b.value !== 'all').map((line) => (
                      <option key={line.value} value={line.value}>{line.label}</option>
                    ))}
                  </select>
                  {errors.businessLine && <p className="text-xs text-red-400 mt-1">{errors.businessLine.message}</p>}
                </div>
                <div>
                  <label className="label mb-1 block">Stage</label>
                  <select
                    className="input"
                    title="Stage"
                    {...register('stage')}
                  >
                    {STAGES.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                  {errors.stage && <p className="text-xs text-red-400 mt-1">{errors.stage.message}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label mb-1 block">Deal Value</label>
                  <input
                    className="input"
                    type="number"
                    title="Deal value"
                    min="0"
                    {...register('dealValue')}
                  />
                  {errors.dealValue && <p className="text-xs text-red-400 mt-1">{errors.dealValue.message}</p>}
                </div>
                <div>
                  <label className="label mb-1 block">Expected Close Date</label>
                  <input
                    className="input"
                    type="date"
                    title="Expected close date"
                    {...register('expectedCloseDate')}
                  />
                  {errors.expectedCloseDate && <p className="text-xs text-red-400 mt-1">{errors.expectedCloseDate.message}</p>}
                </div>
              </div>
              <div>
                <label className="label mb-1 block">Lead Lookup</label>
                <select
                  className="input"
                  title="Lead lookup"
                  {...register('leadId')}
                >
                  <option value="">Select lead (optional)</option>
                  {leads.map((lead: any) => (
                    <option key={lead.id} value={lead.id}>{lead.companyName}</option>
                  ))}
                </select>
              </div>
              {createServerError && <p className="text-xs text-red-400">{createServerError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  className="btn-ghost flex-1"
                  onClick={() => {
                    setCreateOpen(false);
                    setCreateServerError('');
                    reset(defaultOpportunityValues);
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex-1" disabled={createMutation.isPending}>Create Opportunity</button>
              </div>
            </form>
          </div>
        </div>

      )}

      {/* Stage Activity Requirement Confirmation */}
      {stageConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 w-full max-w-md">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={16} className="text-amber-400" />
              <h3 className="section-title">Activity Requirement</h3>
            </div>
            <p className="text-sm text-slate-300">{stageConfirmModal.message}</p>
            <p className="text-xs text-slate-500 mt-2">If the required activity is missing, the server will reject this change.</p>
            <div className="flex gap-2 mt-4">
              <button className="btn-ghost flex-1" onClick={() => setStageConfirmModal(null)}>Cancel</button>
              <button
                className="btn-primary flex-1"
                onClick={() => {
                  updateStageMutation.mutate({ id: stageConfirmModal.id, stage: stageConfirmModal.stage });
                  setStageConfirmModal(null);
                }}
                disabled={updateStageMutation.isPending}
              >
                Yes, Move Stage
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Closed Won / Lost Reason Modal */}
      {reasonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 w-full max-w-md">
            {reasonModal.stage === 'closed_won' ? (
              <>
                <h3 className="section-title">Win Reason <span className="text-emerald-400">✓</span></h3>
                <p className="text-xs text-slate-500 mt-1">Describe why this deal was won before closing.</p>
                <textarea
                  className="input mt-3 min-h-[100px]"
                  value={wonLostReason}
                  onChange={(e) => setWonLostReason(e.target.value)}
                  placeholder="e.g. Best price, strong relationship, feature fit..."
                />
              </>
            ) : (
              <>
                <h3 className="section-title">Loss Reason <span className="text-red-400">×</span></h3>
                <p className="text-xs text-slate-500 mt-1">Select a category and describe why this deal was lost.</p>
                <div className="mt-3">
                  <label className="label mb-1 block">Loss Category</label>
                  <select
                    className="input"
                    title="Loss reason category"
                    value={lostReasonCategory}
                    onChange={(e) => setLostReasonCategory(e.target.value)}
                  >
                    {LOST_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <textarea
                  className="input mt-3 min-h-[80px]"
                  value={wonLostReason}
                  onChange={(e) => setWonLostReason(e.target.value)}
                  placeholder="Additional details about why the deal was lost..."
                />
              </>
            )}
            <div className="flex gap-2 mt-3">
              <button className="btn-ghost flex-1" onClick={() => { setReasonModal(null); setWonLostReason(''); }}>
                Cancel
              </button>
              <button
                className="btn-primary flex-1"
                onClick={() => {
                  if (!wonLostReason.trim()) {
                    toast.error(reasonModal.stage === 'closed_won' ? 'Win reason is required' : 'Loss reason is required');
                    return;
                  }
                  const reason = reasonModal.stage === 'closed_lost'
                    ? `[${lostReasonCategory}] ${wonLostReason.trim()}`
                    : wonLostReason.trim();
                  updateStageMutation.mutate({ id: reasonModal.id, stage: reasonModal.stage, reason });
                }}
                disabled={updateStageMutation.isPending}
              >
                Save &amp; Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
