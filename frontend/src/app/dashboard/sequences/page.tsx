'use client';
import { GitBranch, Plus, CheckCircle2, Workflow, Users, Clock, FileText } from 'lucide-react';
import { PageHero } from '../../../components/ui/PageHero';

const DEMO_SEQUENCE = {
  name: 'Outreach Sequence',
  contacts: 42,
  steps: [
    { day: 'Day 1', action: 'Send intro email', template: 'NetSuite Integration Intro', status: 'active' },
    { day: 'Day 3', action: 'Follow-up if no reply', template: 'Quick check-in', status: 'active' },
    { day: 'Day 7', action: 'Value-add email with case study', template: 'Case study share', status: 'active' },
    { day: 'Day 14', action: 'Final breakup email', template: 'Last attempt', status: 'draft' },
  ],
};

export default function SequencesPage() {
  return (
    <div className="space-y-6">
      <PageHero
        icon={GitBranch}
        eyebrow="Outreach"
        title="Email Sequences"
        subtitle="Automated multi-step outreach workflows"
        tone="violet"
      >
        <button className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-white text-indigo-700 font-semibold text-sm shadow-lg shadow-indigo-900/20 hover:bg-blue-50 hover:-translate-y-px transition-all"><Plus size={16}/> New Sequence</button>
      </PageHero>

      <div className="card relative overflow-hidden p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 w-48 h-48 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="relative flex items-start justify-between gap-3 mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-md shadow-violet-500/30 flex items-center justify-center flex-shrink-0">
              <Workflow size={18}/>
            </div>
            <div className="min-w-0">
              <p className="font-display text-base font-semibold text-ink truncate">{DEMO_SEQUENCE.name}</p>
              <p className="text-xs text-ink-3 mt-0.5 inline-flex items-center gap-1.5">
                <Users size={12}/> {DEMO_SEQUENCE.contacts} active contacts · 4 steps
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"/>
            Active
          </span>
        </div>

        <div className="relative space-y-0">
          {DEMO_SEQUENCE.steps.map((step, i) => (
            <div key={i} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/30 flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {i+1}
                </div>
                {i < DEMO_SEQUENCE.steps.length - 1 && (
                  <div className="w-px flex-1 my-1.5 border-l-2 border-dashed border-indigo-200 dark:border-indigo-500/25"/>
                )}
              </div>
              <div className={`flex-1 min-w-0 ${i < DEMO_SEQUENCE.steps.length - 1 ? 'pb-5' : ''}`}>
                <div className="rounded-xl p-4 flex items-center justify-between gap-3 bg-white dark:bg-surface-2 border border-line hover:border-indigo-300 dark:hover:border-indigo-500/40 transition-colors">
                  <div className="min-w-0">
                    <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-indigo-600 dark:text-indigo-400 mb-1"><Clock size={11}/> {step.day}</p>
                    <p className="text-sm font-semibold text-ink">{step.action}</p>
                    <p className="text-xs text-ink-3 mt-0.5 inline-flex items-center gap-1"><FileText size={11}/> Template: {step.template}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold capitalize flex-shrink-0 ${step.status === 'active' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-slate-400/10 text-ink-3'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${step.status === 'active' ? 'bg-emerald-500' : 'bg-slate-400'}`}/>
                    {step.status}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
