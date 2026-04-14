'use client';
import { GitBranch, Plus, CheckCircle2 } from 'lucide-react';
import { Badge } from '../../../components/ui';

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
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Email Sequences</h1>
          <p className="text-sm text-slate-500 mt-1">Automated multi-step outreach workflows</p>
        </div>
        <button className="btn-primary"><Plus size={14}/> New Sequence</button>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-1">
          <p className="font-semibold text-slate-800 dark:text-slate-200">{DEMO_SEQUENCE.name}</p>
          <Badge color="green">Active</Badge>
        </div>
        <p className="text-sm text-slate-500 mb-6">{DEMO_SEQUENCE.contacts} active contacts · 4 steps</p>

        <div className="space-y-0">
          {DEMO_SEQUENCE.steps.map((step, i) => (
            <div key={i} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-blue-500/15 border-2 border-blue-500/30 flex items-center justify-center text-xs font-bold text-blue-400 flex-shrink-0">
                  {i+1}
                </div>
                {i < DEMO_SEQUENCE.steps.length - 1 && (
                  <div className="w-0.5 flex-1 bg-blue-500/15 my-1"/>
                )}
              </div>
              <div className={`flex-1 ${i < DEMO_SEQUENCE.steps.length - 1 ? 'pb-5' : ''}`}>
                <div className="bg-slate-100 dark:bg-slate-950 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-blue-400 mb-0.5">{step.day}</p>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{step.action}</p>
                    <p className="text-xs text-slate-500">Template: {step.template}</p>
                  </div>
                  <Badge color={step.status === 'active' ? 'green' : 'gray'}>{step.status}</Badge>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
