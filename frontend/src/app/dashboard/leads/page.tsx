'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { leadsApi } from '../../../lib/api';
import { Badge, Avatar, ScoreRing, Spinner, EmptyState } from '../../../components/ui';
import { CreateLeadModal } from '../../../components/crm/CreateLeadModal';
import { getInitials, downloadBlob, intentColors, statusColors } from '../../../lib/utils';
import { Users, Plus, Download, Search } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';

export default function LeadsPage() {
  const [page, setPage]               = useState(1);
  const [search, setSearch]           = useState('');
  const [intentFilter, setIntentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Backend returns:
  // { success, data: Lead[], pagination: { total, page, limit, totalPages } }
  const { data, isLoading } = useQuery({
    queryKey: ['leads', page, search, intentFilter, statusFilter],
    queryFn: () =>
      leadsApi
        .list({ page, limit: 20, search: search || undefined, intent: intentFilter || undefined, status: statusFilter || undefined })
        .then(r => r.data),
    placeholderData: (prev) => prev,
  });

  async function handleExport() {
    try {
      const resp = await leadsApi.export();
      downloadBlob(resp.data, 'leads.csv');
      toast.success('CSV exported');
    } catch {
      toast.error('Export failed');
    }
  }

  // r.data = axios body = { success, data: Lead[], pagination: {...} }
  const leads      = (data?.data as any[])      ?? [];
  const pagination = data?.pagination            ?? null;
  const total      = pagination?.total           ?? 0;
  const totalPages = pagination?.totalPages      ?? 1;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Leads CRM</h1>
          <p className="text-sm text-slate-500 mt-1">{total.toLocaleString()} AI-discovered leads</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-ghost" onClick={handleExport}>
            <Download size={14} /> Export CSV
          </button>
          <button className="btn-primary" onClick={() => setIsCreateModalOpen(true)}>
            <Plus size={14} /> Add Lead
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="input pl-8 h-9 w-48 text-xs"
            placeholder="Search leads…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select className="input h-9 text-xs w-auto" value={intentFilter}
          onChange={e => { setIntentFilter(e.target.value); setPage(1); }}>
          <option value="">All Intent</option>
          <option value="hot">🔥 Hot</option>
          <option value="warm">Warm</option>
          <option value="cold">Cold</option>
        </select>
        <select className="input h-9 text-xs w-auto" value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All Status</option>
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="replied">Replied</option>
          <option value="meeting_booked">Meeting Booked</option>
          <option value="qualified">Qualified</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Spinner size={24} />
          </div>
        ) : leads.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No leads found"
            description="Run an AI scan to discover companies that need your services"
            action={
              <div className="flex gap-2">
                <Link href="/dashboard/lead-discovery" className="btn-primary">
                  Run AI Scan
                </Link>
                <button onClick={() => setIsCreateModalOpen(true)} className="btn-ghost">
                  <Plus size={14} /> Add Lead Manually
                </button>
              </div>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['Company', 'Industry', 'Contact', 'Tech Stack', 'Top Signal', 'Score', 'Intent', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map((l: any) => (
                  <tr key={l.id} className="border-b border-white/[0.04] hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/leads/${l.id}`} className="flex items-center gap-2.5">
                        <Avatar initials={getInitials(l.companyName)} size="sm" />
                        <div>
                          <p className="text-sm font-semibold text-slate-200">{l.companyName}</p>
                          <p className="text-xs text-slate-500">{l.website}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{l.industry || '—'}</td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-slate-200">{l.contactName || '—'}</p>
                      <p className="text-xs text-slate-500">{l.contactTitle}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {(l.techStack ?? []).slice(0, 2).map((t: string) => (
                          <span key={t} className="bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded px-1.5 py-0.5 text-[10px]">
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-blue-400 max-w-[160px] truncate">
                      {(l.intentSignals?.[0] as any)?.text ?? l.intentSignals?.[0] ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <ScoreRing score={l.leadScore} size={36} />
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-bold ${l.intentScore >= 80 ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {l.intentScore}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={statusColors[l.status] ?? 'gray'}>
                        {l.status?.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/leads/${l.id}`} className="btn-ghost text-xs py-1 px-2">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">{total} total leads</span>
          <div className="flex gap-1">
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                  p === page
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Create Lead Modal */}
      <CreateLeadModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </div>
  );
}
