'use client';

import { useMemo } from 'react';
import { Badge } from '../../components/ui';
import { formatDate } from '../../lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import {
  Users, TrendingUp, DollarSign, AlertTriangle, Clock,
  BarChart3, PieChart as PieIcon, Target, Calendar, Percent,
  Filter,
} from 'lucide-react';
import Link from 'next/link';

// ── Types ──────────────────────────────────────────────────────────────────
export interface DashboardWidget {
  id: string;
  type: 'stat_card' | 'list' | 'bar_chart' | 'pie_chart' | 'pipeline_chart' | 'table' | 'currency_card';
  title: string;
  description?: string;
  icon?: string;
  color?: string;
  data: any;
  layout?: 'half' | 'full';
}

// ── Constants ──────────────────────────────────────────────────────────────
const CHART_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#ec4899', '#6366f1'];

const STAGE_COLORS: Record<string, string> = {
  qualified: '#3b82f6',
  demo: '#8b5cf6',
  proposal: '#f59e0b',
  negotiation: '#f97316',
  closed_won: '#10b981',
  closed_lost: '#ef4444',
};

const STAGE_BADGE_COLORS: Record<string, string> = {
  qualified: 'bg-blue-500/15 text-blue-400',
  demo: 'bg-violet-500/15 text-violet-400',
  proposal: 'bg-amber-500/15 text-amber-400',
  negotiation: 'bg-orange-500/15 text-orange-400',
  closed_won: 'bg-emerald-500/15 text-emerald-400',
  closed_lost: 'bg-red-500/15 text-red-400',
};

const ICON_MAP: Record<string, any> = {
  users: Users,
  trending_up: TrendingUp,
  dollar: DollarSign,
  alert: AlertTriangle,
  clock: Clock,
  bar_chart: BarChart3,
  pie_chart: PieIcon,
  target: Target,
  calendar: Calendar,
  percent: Percent,
  filter: Filter,
};

const COLOR_MAP: Record<string, string> = {
  blue: 'text-blue-400',
  green: 'text-emerald-400',
  emerald: 'text-emerald-400',
  violet: 'text-violet-400',
  purple: 'text-violet-400',
  amber: 'text-amber-400',
  red: 'text-red-400',
  cyan: 'text-cyan-400',
  orange: 'text-orange-400',
};

export const DATE_PRESETS = [
  { label: 'This Week', value: 'this_week' },
  { label: 'This Month', value: 'this_month' },
  { label: 'Last 30 Days', value: 'last_30' },
  { label: 'This Quarter', value: 'this_quarter' },
  { label: 'All Time', value: 'all' },
];

// ── Helpers ────────────────────────────────────────────────────────────────
export const formatUSD = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(v || 0));

function DarkTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-slate-400 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-semibold" style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' && p.name?.toLowerCase().includes('revenue') ? formatUSD(p.value) : p.value}
          {typeof p.value === 'number' && p.name?.toLowerCase().includes('rate') ? '%' : ''}
        </p>
      ))}
    </div>
  );
}

function getIcon(name?: string) {
  if (!name) return null;
  return ICON_MAP[name] ?? null;
}

function getColorClass(name?: string) {
  if (!name) return 'text-blue-400';
  return COLOR_MAP[name] ?? 'text-blue-400';
}

// ── Widget: Stat Card ──────────────────────────────────────────────────────
function StatCardWidget({ widget }: { widget: DashboardWidget }) {
  const Icon = getIcon(widget.icon);
  const colorCls = getColorClass(widget.color);
  const value = widget.data?.value ?? widget.data ?? 0;
  const suffix = widget.data?.suffix ?? '';
  const prefix = widget.data?.prefix ?? '';
  const subtitle = widget.data?.subtitle ?? widget.description ?? '';

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-500">{widget.data?.tag ?? 'Count'}</span>
        {Icon && <Icon size={14} className={colorCls} />}
      </div>
      <p className={`text-2xl font-bold ${colorCls === 'text-blue-400' ? 'text-slate-100' : colorCls}`}>
        {prefix}{typeof value === 'number' ? value.toLocaleString() : value}{suffix}
      </p>
      <p className="text-xs text-slate-400 mt-1 font-medium">{widget.title}</p>
      {subtitle && <p className="text-[10px] text-slate-600 mt-0.5">{subtitle}</p>}
    </div>
  );
}

// ── Widget: Currency Card ──────────────────────────────────────────────────
function CurrencyCardWidget({ widget }: { widget: DashboardWidget }) {
  const Icon = getIcon(widget.icon);
  const colorCls = getColorClass(widget.color);
  const value = Number(widget.data?.value ?? widget.data ?? 0);

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Currency</span>
        {Icon && <Icon size={14} className={colorCls} />}
      </div>
      <p className={`text-2xl font-bold ${colorCls}`}>{formatUSD(value)}</p>
      <p className="text-xs text-slate-400 mt-1 font-medium">{widget.title}</p>
      {widget.description && <p className="text-[10px] text-slate-600 mt-0.5">{widget.description}</p>}
    </div>
  );
}

// ── Widget: List (Follow-ups, Overdue, Stuck Deals) ────────────────────────
function ListWidget({ widget }: { widget: DashboardWidget }) {
  const Icon = getIcon(widget.icon);
  const colorCls = getColorClass(widget.color);
  const items: any[] = Array.isArray(widget.data?.items) ? widget.data.items : Array.isArray(widget.data) ? widget.data : [];
  const variant = widget.data?.variant ?? 'default'; // 'default' | 'danger' | 'warning' | 'follow_up'

  const isDanger = variant === 'danger' || widget.id?.includes('overdue');
  const isWarning = variant === 'warning' || widget.id?.includes('stuck');
  const isFollowUp = variant === 'follow_up' || widget.id?.includes('follow_up');

  // Sort follow-ups by temperature
  const sortedItems = useMemo(() => {
    if (!isFollowUp) return items;
    return [...items].sort((a: any, b: any) => {
      const rank: Record<string, number> = { hot: 0, warm: 1, cold: 2 };
      return (rank[a.temperature] ?? 2) - (rank[b.temperature] ?? 2);
    });
  }, [items, isFollowUp]);

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        {Icon && <Icon size={15} className={colorCls} />}
        <h2 className="section-title">{widget.title}</h2>
        {items.length > 0 && (isDanger || isWarning) && (
          <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full border ${
            isDanger
              ? 'bg-red-500/15 text-red-400 border-red-500/25'
              : 'bg-amber-500/15 text-amber-400 border-amber-500/25'
          }`}>
            {items.length}
          </span>
        )}
      </div>
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {sortedItems.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center">
            {isDanger ? 'No overdue items' : isWarning ? 'No stuck deals' : isFollowUp ? 'No follow-ups due today' : 'No data'}
          </p>
        ) : (
          sortedItems.map((item: any, idx: number) => {
            if (isFollowUp) {
              return (
                <div key={item.leadId || idx}
                  className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-200 truncate">{item.companyName || '—'}</p>
                    {item.contactName && <p className="text-xs text-slate-500 truncate">{item.contactName}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {item.temperature && (
                      <Badge color={item.temperature === 'hot' ? 'red' : item.temperature === 'warm' ? 'amber' : 'gray'}>
                        {item.temperature.charAt(0).toUpperCase() + item.temperature.slice(1)}
                      </Badge>
                    )}
                    {item.leadId && (
                      <Link href={`/dashboard/leads/${item.leadId}`} className="btn-ghost text-xs py-1 px-2">View</Link>
                    )}
                  </div>
                </div>
              );
            }

            if (isDanger) {
              return (
                <div key={item.leadId || idx}
                  className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-red-300 truncate">{item.companyName || item.leadCompanyName || '—'}</p>
                    <p className="text-xs text-red-400/70 mt-0.5">
                      {item.followUpDate ? formatDate(item.followUpDate) : 'No date'}
                    </p>
                    {item.executiveName && <p className="text-[10px] text-slate-600 mt-0.5">Owner: {item.executiveName}</p>}
                  </div>
                  <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
                </div>
              );
            }

            if (isWarning) {
              return (
                <div key={item.id || idx} className="px-3 py-2.5 rounded-xl border border-white/10 bg-slate-950 hover:bg-slate-800/20">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-200 truncate">{item.opportunityName || item.companyName || '—'}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Stage: <span className="text-amber-400">{(item.currentStage || item.stage || '—').replace('_', ' ')}</span>
                        {' · '}{item.daysStuck ?? item.daysSinceUpdate ?? 0} days
                      </p>
                      {(item.ownerName || item.executiveName) && (
                        <p className="text-[10px] text-slate-600 mt-0.5">Owner: {item.ownerName || item.executiveName}</p>
                      )}
                    </div>
                    <AlertTriangle size={12} className="text-amber-400/60 flex-shrink-0 mt-1" />
                  </div>
                </div>
              );
            }

            // generic list item
            return (
              <div key={item.id || idx} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5">
                <p className="text-sm font-medium text-slate-200">{item.title || item.companyName || item.name || '—'}</p>
                {item.subtitle && <p className="text-xs text-slate-500 mt-0.5">{item.subtitle}</p>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Widget: Bar Chart ──────────────────────────────────────────────────────
function BarChartWidget({ widget }: { widget: DashboardWidget }) {
  const Icon = getIcon(widget.icon);
  const colorCls = getColorClass(widget.color);
  const items: any[] = Array.isArray(widget.data?.items) ? widget.data.items : Array.isArray(widget.data) ? widget.data : [];
  const dataKey = widget.data?.dataKey ?? 'value';
  const nameKey = widget.data?.nameKey ?? 'name';
  const barColor = widget.data?.barColor ?? '#3b82f6';
  const isPercentage = widget.data?.isPercentage ?? false;
  const barLabel = widget.data?.barLabel ?? widget.title ?? 'Value';

  const chartData = items.map((e: any) => ({
    name: e[nameKey] || e.executiveName || e.name || '—',
    value: Number(e[dataKey] ?? e.value ?? e.leadCount ?? e.count ?? 0),
  }));

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2">
        {Icon && <Icon size={15} className={colorCls} />}
        <h2 className="section-title">{widget.title}</h2>
      </div>
      {chartData.length === 0 ? (
        <p className="text-sm text-slate-500 px-5 py-8 text-center">No data yet</p>
      ) : (
        <div className="px-4 py-4" style={{ height: Math.max(200, chartData.length * 40 + 40) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
              <XAxis type="number" 
                domain={isPercentage ? [0, 100] : undefined}
                tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false}
                tickFormatter={isPercentage ? (v: number) => `${v}%` : undefined}
              />
              <YAxis type="category" dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 11 }} axisLine={false} tickLine={false} width={100} />
              <Tooltip content={<DarkTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="value" name={barLabel} fill={barColor} radius={[0, 4, 4, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Widget: Pipeline Chart (dual axis) ─────────────────────────────────────
function PipelineChartWidget({ widget }: { widget: DashboardWidget }) {
  const Icon = getIcon(widget.icon);
  const colorCls = getColorClass(widget.color);
  const items: any[] = Array.isArray(widget.data?.items) ? widget.data.items : Array.isArray(widget.data) ? widget.data : [];

  const chartData = items.map((s: any) => ({
    name: (s.stage || '—').replace('_', ' '),
    count: s.count ?? 0,
    value: s.value ?? s.totalValue ?? 0,
    fill: STAGE_COLORS[s.stage] ?? '#64748b',
  }));

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2">
        {Icon && <Icon size={15} className={colorCls} />}
        <h2 className="section-title">{widget.title}</h2>
        {widget.description && <span className="text-xs text-slate-500 ml-1">{widget.description}</span>}
      </div>
      {chartData.length === 0 ? (
        <p className="text-sm text-slate-500 px-5 py-8 text-center">No pipeline data</p>
      ) : (
        <div className="px-4 py-4" style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ left: 10, right: 10, bottom: 20 }}>
              <XAxis dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="count" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="value" orientation="right" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<DarkTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar yAxisId="count" dataKey="count" name="Deals" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={30} />
              <Bar yAxisId="value" dataKey="value" name="Revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={30} opacity={0.6} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Widget: Pie Chart ──────────────────────────────────────────────────────
function PieChartWidget({ widget }: { widget: DashboardWidget }) {
  const Icon = getIcon(widget.icon);
  const colorCls = getColorClass(widget.color);
  const items: any[] = Array.isArray(widget.data?.items) ? widget.data.items : Array.isArray(widget.data) ? widget.data : [];

  const chartData = items.map((r: any, i: number) => ({
    name: r.reason || r.lossReason || r.name || '—',
    count: r.count ?? 0,
    value: r.value ?? r.dealValue ?? 0,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2">
        {Icon && <Icon size={15} className={colorCls} />}
        <h2 className="section-title">{widget.title}</h2>
      </div>
      {chartData.length === 0 ? (
        <p className="text-sm text-slate-500 px-5 py-8 text-center">No data</p>
      ) : (
        <div className="p-4 flex flex-col items-center">
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={chartData} dataKey="count" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2} stroke="none">
                  {chartData.map((entry: any, i: number) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip content={<DarkTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3 justify-center mt-2">
            {chartData.map((entry: any, i: number) => (
              <div key={i} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.fill }} />
                <span className="text-[10px] text-slate-400">{entry.name} ({entry.count})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Widget: Table (Overdue follow-ups, team perf, etc.) ────────────────────
function TableWidget({ widget }: { widget: DashboardWidget }) {
  const Icon = getIcon(widget.icon);
  const colorCls = getColorClass(widget.color);
  const items: any[] = Array.isArray(widget.data?.items) ? widget.data.items : Array.isArray(widget.data) ? widget.data : [];
  const columns: { key: string; label: string; color?: string }[] = widget.data?.columns ?? [];

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2">
        {Icon && <Icon size={15} className={colorCls} />}
        <h2 className="section-title">{widget.title}</h2>
        {items.length > 0 && widget.data?.showCount && (
          <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full border ${
            widget.color === 'red'
              ? 'bg-red-500/15 text-red-400 border-red-500/25'
              : 'bg-blue-500/15 text-blue-400 border-blue-500/25'
          }`}>
            {items.length}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500 px-5 py-8 text-center">No data</p>
      ) : (
        <div className="max-h-64 overflow-y-auto overflow-x-auto">
          <table className="w-full">
            {columns.length > 0 && (
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {columns.map((col) => (
                    <th key={col.key} className="px-4 py-3 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{col.label}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {items.map((row: any, i: number) => (
                <tr key={row.id || i} className="border-b border-white/[0.04] hover:bg-slate-800/20">
                  {columns.map((col) => (
                    <td key={col.key} className={`px-4 py-3 text-sm ${col.color === 'red' ? 'text-red-400' : col.color === 'green' ? 'text-emerald-400' : col.color === 'primary' ? 'font-medium text-slate-200' : 'text-slate-400'}`}>
                      {col.key === 'followUpDate' && row[col.key] ? formatDate(row[col.key]) : (row[col.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Widget: Open Opportunities by Stage (stage view) ───────────────────────
function OpportunitiesByStageWidget({ widget }: { widget: DashboardWidget }) {
  const Icon = getIcon(widget.icon);
  const colorCls = getColorClass(widget.color);
  const items: any[] = Array.isArray(widget.data?.items) ? widget.data.items : Array.isArray(widget.data) ? widget.data : [];

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2">
        {Icon && <Icon size={14} className={colorCls} />}
        <h2 className="section-title">{widget.title}</h2>
        {widget.description && <span className="text-xs text-slate-500 ml-1">{widget.description}</span>}
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-8 text-sm text-slate-500 text-center">No open opportunities</p>
      ) : (
        <div className="divide-y divide-white/[0.04]">
          {items.map((row: any, idx: number) => (
            <div key={row.stage || idx} className="px-5 py-3 flex items-center gap-3">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STAGE_BADGE_COLORS[row.stage] ?? 'bg-slate-700/40 text-slate-400'}`}>
                {(row.stage || '—').replace('_', ' ')}
              </span>
              <span className="text-sm text-slate-400 ml-auto">{row.count ?? 0} deals</span>
              <span className="text-sm text-emerald-400 font-semibold w-24 text-right">
                {formatUSD(row.totalValue ?? row.value ?? 0)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Date Filter Bar ────────────────────────────────────────────────────────
export function DateFilterBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Filter size={14} className="text-slate-500" />
      <span className="text-xs text-slate-500 font-medium">Period:</span>
      {DATE_PRESETS.map((p) => (
        <button
          key={p.value}
          onClick={() => onChange(p.value)}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
            value === p.value
              ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
              : 'bg-slate-800/50 text-slate-400 border border-white/5 hover:bg-slate-800 hover:text-slate-300'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ── Master Widget Renderer ─────────────────────────────────────────────────
export function RenderWidget({ widget }: { widget: DashboardWidget }) {
  switch (widget.type) {
    case 'stat_card':
      return <StatCardWidget widget={widget} />;
    case 'currency_card':
      return <CurrencyCardWidget widget={widget} />;
    case 'list':
      return <ListWidget widget={widget} />;
    case 'bar_chart':
      return <BarChartWidget widget={widget} />;
    case 'pipeline_chart':
      return widget.data?.items?.length > 0 || Array.isArray(widget.data) ? <PipelineChartWidget widget={widget} /> : <OpportunitiesByStageWidget widget={widget} />;
    case 'pie_chart':
      return <PieChartWidget widget={widget} />;
    case 'table':
      return <TableWidget widget={widget} />;
    default:
      return null;
  }
}

// ── Layout: Render a row of widgets ────────────────────────────────────────
export function WidgetGrid({ widgets }: { widgets: DashboardWidget[] }) {
  // Group by row: full-width widgets get their own row, half-width get paired
  const rows: DashboardWidget[][] = [];
  let halfRow: DashboardWidget[] = [];

  for (const w of widgets) {
    if (w.layout === 'full') {
      if (halfRow.length > 0) {
        rows.push(halfRow);
        halfRow = [];
      }
      rows.push([w]);
    } else {
      halfRow.push(w);
      if (halfRow.length === 2) {
        rows.push(halfRow);
        halfRow = [];
      }
    }
  }
  if (halfRow.length > 0) rows.push(halfRow);

  return (
    <>
      {rows.map((row, i) => {
        if (row.length === 1 && row[0].layout === 'full') {
          return <div key={row[0].id || i}><RenderWidget widget={row[0]} /></div>;
        }
        // Stat cards: if multiple, use a responsive grid
        const allStats = row.every(w => w.type === 'stat_card' || w.type === 'currency_card');
        if (allStats && row.length > 2) {
          return (
            <div key={`row-${i}`} className={`grid gap-3 ${
              row.length <= 2 ? 'grid-cols-2' :
              row.length <= 3 ? 'grid-cols-1 md:grid-cols-3' :
              row.length <= 4 ? 'grid-cols-2 xl:grid-cols-4' :
              'grid-cols-2 lg:grid-cols-3 xl:grid-cols-' + Math.min(row.length, 6)
            }`}>
              {row.map(w => <RenderWidget key={w.id} widget={w} />)}
            </div>
          );
        }
        return (
          <div key={`row-${i}`} className={`grid grid-cols-1 ${row.length > 1 ? 'lg:grid-cols-2' : ''} gap-4`}>
            {row.map(w => <RenderWidget key={w.id} widget={w} />)}
          </div>
        );
      })}
    </>
  );
}
