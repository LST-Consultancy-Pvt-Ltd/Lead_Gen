'use client';

/**
 * Follow-up Calendar — shared by the Admin, Manager and Executive dashboards.
 *
 * Every entry carries entityType + entityId, so clicking one opens the record it
 * actually belongs to. A lead and an opportunity can share a company name, so
 * navigation is never driven by the title.
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format,
  isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek,
} from 'date-fns';
import {
  AlertTriangle, ArrowUpRight, CalendarDays, CalendarCheck, CalendarSearch,
  CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock, Mail, Phone,
  Presentation, Users,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { analyticsApi, leadsApi, opportunitiesApi } from '../../lib/api';
import { SectionCard, CountPill, EmptyBlock, MultiFilterSelect, PersonAvatar } from './DashboardUI';
import { cn } from '../../lib/utils';

/** Compact trigger for the calendar toolbar: nav-button height, no slack. */
const FILTER_TRIGGER_CLS = 'h-8 w-[140px] pl-9 pr-7 text-xs rounded-lg';

const STATUS_OPTIONS = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
];

/** Jan…Dec, formatted the same way as every other date in the calendar. */
const MONTH_LABELS = Array.from({ length: 12 }, (_, i) => format(new Date(2000, i, 1), 'MMM'));

// ── Types ──────────────────────────────────────────────────────────────────

export type FollowUpStatus = 'overdue' | 'today' | 'upcoming';

export interface FollowUpItem {
  id: string;
  entityType: 'lead' | 'opportunity';
  entityId: string;
  title: string;
  subtitle: string | null;
  followUpDate: string;
  activityType: string;
  status: FollowUpStatus;
  recordStatus?: string;
  dealValue?: number;
  assignedTo?: { id: string; name: string } | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const dayKey = (d: Date | string) => format(new Date(d), 'yyyy-MM-dd');

const STATUS_STYLES: Record<FollowUpStatus, { chip: string; rail: string; pill: string; label: string }> = {
  overdue: {
    chip: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-l-2 border-rose-500',
    rail: 'bg-rose-500',
    pill: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    label: 'Overdue',
  },
  today: {
    chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-l-2 border-amber-500',
    rail: 'bg-amber-500',
    pill: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    label: 'Today',
  },
  upcoming: {
    chip: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-l-2 border-blue-500',
    rail: 'bg-blue-500',
    pill: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    label: 'Upcoming',
  },
};

const ACTIVITY_ICONS: Record<string, typeof Phone> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  demo: Presentation,
};

const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'demo', 'follow_up', 'whatsapp', 'linkedin', 'note', 'other'];

function prettyType(t: string) {
  return (t || 'follow up').replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeStr(d: string) {
  return format(new Date(d), 'h:mm a');
}

function daysBetween(d: string) {
  const a = new Date(d);
  a.setHours(0, 0, 0, 0);
  const b = new Date();
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Where an entry opens. Opportunities have no detail route — the list page
 *  focuses the drawer from ?focus=<id>. */
function hrefFor(item: FollowUpItem) {
  return item.entityType === 'lead'
    ? `/dashboard/leads/${item.entityId}`
    : `/dashboard/opportunities?focus=${item.entityId}`;
}

// ── Component ──────────────────────────────────────────────────────────────

export function FollowUpCalendar({
  scopeLabel,
  assignees,
  showOwnerBreakdown = false,
  ownerBreakdownTitle = 'Overdue by owner',
}: {
  scopeLabel: string;
  /** Manager / Admin: lets the calendar be filtered to one person. */
  assignees?: { id: string; name: string }[];
  showOwnerBreakdown?: boolean;
  ownerBreakdownTitle?: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();

  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());
  const [statuses, setStatuses] = useState<string[]>([]);
  const [owners, setOwners] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => new Date().getFullYear());
  const [pickerMonth, setPickerMonth] = useState(() => new Date().getMonth());

  // ── Visible window ──────────────────────────────────────────────────────
  // The whole grid, spill-over days included, so the first and last cells of
  // the month are not silently empty.
  const { from, to, gridDays } = useMemo(() => {
    const s = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
    const e = endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
    return { from: s, to: e, gridDays: eachDayOfInterval({ start: s, end: e }) };
  }, [anchor]);

  const params = {
    from: format(from, 'yyyy-MM-dd'),
    to: format(to, 'yyyy-MM-dd'),
    // Calendar shows leads only; opportunities are tracked on their own page.
    entityType: 'lead',
    ...(statuses.length ? { status: statuses.join(',') } : {}),
    ...(owners.length ? { assignedToId: owners.join(',') } : {}),
  };

  const { data, isLoading } = useQuery({
    queryKey: ['followUpCalendar', params],
    queryFn: () =>
      analyticsApi.getFollowUpCalendar(params).then((r) => r.data?.data ?? r.data ?? {}),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const items: FollowUpItem[] = data?.items ?? [];
  const overdue: FollowUpItem[] = data?.overdue ?? [];
  const counts = data?.counts ?? { overdue: 0, today: 0, upcoming: 0, inRange: 0 };

  const byDay = useMemo(() => {
    const m = new Map<string, FollowUpItem[]>();
    for (const it of items) {
      const k = dayKey(it.followUpDate);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(it);
    }
    return m;
  }, [items]);

  const selectedItems = byDay.get(dayKey(selected)) ?? [];

  const ownerRows = useMemo(() => {
    if (!showOwnerBreakdown) return [];
    const m = new Map<string, { id: string; name: string; count: number }>();
    for (const it of overdue) {
      const id = it.assignedTo?.id ?? 'unassigned';
      const name = it.assignedTo?.name ?? 'Unassigned';
      m.set(id, { id, name, count: (m.get(id)?.count ?? 0) + 1 });
    }
    return [...m.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  }, [overdue, showOwnerBreakdown]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['followUpCalendar'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  // ── Reschedule ──────────────────────────────────────────────────────────
  const reschedule = useMutation({
    mutationFn: ({ item, date }: { item: FollowUpItem; date: string }) =>
      item.entityType === 'lead'
        ? leadsApi.update(item.entityId, { followUpDate: date })
        : opportunitiesApi.update(item.entityId, { followUpDate: date }),
    onSuccess: (_r, { date }) => {
      toast.success(`Follow-up moved to ${format(new Date(date), 'd MMM')}`);
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Could not reschedule the follow-up'),
  });

  // ── Header bits ─────────────────────────────────────────────────────────
  const periodLabel = format(anchor, 'MMMM yyyy');

  const step = (dir: 1 | -1) => setAnchor((d) => addMonths(d, dir));

  const goToday = () => {
    const now = new Date();
    setAnchor(now);
    setSelected(now);
  };

  // ── Month / year picker ─────────────────────────────────────────────────
  // Ten years either side of today, always widened to include whatever year
  // the arrows have been stepped to, so the select can never lose its value.
  const pickerYears = useMemo(() => {
    const base = new Date().getFullYear();
    const lo = Math.min(base - 10, pickerYear);
    const hi = Math.max(base + 10, pickerYear);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }, [pickerYear]);

  const openPicker = () => {
    // Open on the month being looked at, not on whatever was picked last.
    setPickerYear(anchor.getFullYear());
    setPickerMonth(anchor.getMonth());
    setPickerOpen((o) => !o);
  };

  // The month and year controls move the calendar behind the popover as well,
  // so closing without picking a date still lands on the month you chose.
  const showMonth = (year: number, month: number) => {
    const first = new Date(year, month, 1);
    setPickerYear(first.getFullYear());
    setPickerMonth(first.getMonth());
    setAnchor(first);
  };

  const pickDate = (d: Date) => {
    setAnchor(d);
    setSelected(d);
    setPickerOpen(false);
  };

  const ownerOptions = useMemo(
    () => (assignees ?? []).map((a) => ({ value: a.id, label: a.name })),
    [assignees],
  );

  /** Full weeks covering the picker's month, so the grid is never ragged. */
  const pickerDays = useMemo(() => {
    const first = new Date(pickerYear, pickerMonth, 1);
    return eachDayOfInterval({
      start: startOfWeek(startOfMonth(first), { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(first), { weekStartsOn: 1 }),
    });
  }, [pickerYear, pickerMonth]);

  const open = (item: FollowUpItem) => router.push(hrefFor(item));

  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-[1.55fr_1fr] gap-4 items-start">
        {/* ── Calendar ──────────────────────────────────────────────────── */}
        <SectionCard
          title="Follow-up Calendar"
          subtitle={scopeLabel}
          icon={CalendarDays}
          tone="indigo"
          action={
            <div className="flex items-center gap-3 text-[11px] font-medium text-ink-3">
              {(['overdue', 'today', 'upcoming'] as FollowUpStatus[]).map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span className={cn('w-2 h-2 rounded-[3px]', STATUS_STYLES[s].rail)} />
                  {STATUS_STYLES[s].label}
                </span>
              ))}
            </div>
          }
        >
          {/* toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 mb-4">
            <div className="flex items-center gap-2">
              <button
                type="button" aria-label="Previous" onClick={() => step(-1)}
                className="w-8 h-8 rounded-lg border border-line flex items-center justify-center text-ink-3 hover:text-ink hover:border-slate-300 dark:hover:border-slate-400/20 transition-colors"
              >
                <ChevronLeft size={15} />
              </button>
              {/* jump straight to any month of any year */}
              <div
                className="relative"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setPickerOpen(false);
                }}
              >
                <button
                  type="button" onClick={openPicker}
                  aria-haspopup="dialog" aria-expanded={pickerOpen}
                  title="Jump to any date"
                  className={cn(
                    'h-8 pl-2 pr-2 rounded-lg border inline-flex items-center gap-1.5 text-[13px] font-semibold transition-colors',
                    pickerOpen
                      ? 'border-indigo-400 dark:border-indigo-500/40 text-indigo-600 dark:text-indigo-400 bg-indigo-500/[0.06]'
                      : 'border-transparent text-ink hover:border-line hover:bg-slate-50 dark:hover:bg-surface-2',
                  )}
                >
                  <CalendarSearch size={14} className="text-indigo-500 dark:text-indigo-400 flex-shrink-0" />
                  <span className="min-w-[116px] text-left">{periodLabel}</span>
                  <ChevronDown size={12} className={cn('flex-shrink-0 transition-transform', pickerOpen && 'rotate-180')} />
                </button>

                {pickerOpen && (
                  <>
                    {/* click-away */}
                    <div className="fixed inset-0 z-20" onClick={() => setPickerOpen(false)} />
                    <div
                      role="dialog" aria-label="Jump to date"
                      className="absolute left-0 top-9 z-30 w-[260px] p-3 rounded-xl border border-line bg-white dark:bg-surface shadow-xl shadow-slate-900/10 dark:shadow-black/40"
                    >
                      {/* month + year */}
                      <div className="flex items-center gap-1.5 mb-2">
                        <button
                          type="button" aria-label="Previous month"
                          onClick={() => {
                            const prev = addMonths(new Date(pickerYear, pickerMonth, 1), -1);
                            showMonth(prev.getFullYear(), prev.getMonth());
                          }}
                          className="w-7 h-7 flex-shrink-0 rounded-lg border border-line flex items-center justify-center text-ink-3 hover:text-ink hover:border-slate-300 dark:hover:border-slate-400/20 transition-colors"
                        >
                          <ChevronLeft size={13} />
                        </button>
                        <select
                          aria-label="Month" value={pickerMonth}
                          onChange={(e) => showMonth(pickerYear, Number(e.target.value))}
                          className="flex-1 min-w-0 h-7 px-1.5 rounded-lg border border-line bg-transparent text-xs font-semibold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30"
                        >
                          {MONTH_LABELS.map((label, i) => (
                            <option key={label} value={i}>{label}</option>
                          ))}
                        </select>
                        <select
                          aria-label="Year" value={pickerYear}
                          onChange={(e) => showMonth(Number(e.target.value), pickerMonth)}
                          className="h-7 px-1.5 rounded-lg border border-line bg-transparent text-xs font-semibold text-ink tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30"
                        >
                          {pickerYears.map((y) => (
                            <option key={y} value={y}>{y}</option>
                          ))}
                        </select>
                        <button
                          type="button" aria-label="Next month"
                          onClick={() => {
                            const next = addMonths(new Date(pickerYear, pickerMonth, 1), 1);
                            showMonth(next.getFullYear(), next.getMonth());
                          }}
                          className="w-7 h-7 flex-shrink-0 rounded-lg border border-line flex items-center justify-center text-ink-3 hover:text-ink hover:border-slate-300 dark:hover:border-slate-400/20 transition-colors"
                        >
                          <ChevronRight size={13} />
                        </button>
                      </div>

                      {/* weekdays */}
                      <div className="grid grid-cols-7 gap-0.5 mb-0.5">
                        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                          <span key={i} className="h-6 flex items-center justify-center text-[10px] font-semibold uppercase text-ink-3">
                            {d}
                          </span>
                        ))}
                      </div>

                      {/* dates */}
                      <div className="grid grid-cols-7 gap-0.5">
                        {pickerDays.map((d) => {
                          const outside = d.getMonth() !== pickerMonth;
                          const isSel = isSameDay(d, selected);
                          return (
                            <button
                              key={d.toISOString()} type="button"
                              onClick={() => pickDate(d)}
                              aria-current={isSel ? 'date' : undefined}
                              className={cn(
                                'h-7 rounded-lg text-xs font-medium tabular-nums transition-colors',
                                isSel
                                  ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                                  : isToday(d)
                                    ? 'text-indigo-600 dark:text-indigo-400 font-semibold bg-indigo-500/[0.08] hover:bg-indigo-500/[0.16]'
                                    : outside
                                      ? 'text-ink-3/50 hover:bg-slate-100 dark:hover:bg-surface-2'
                                      : 'text-ink-2 hover:bg-slate-100 dark:hover:bg-surface-2',
                              )}
                            >
                              {format(d, 'd')}
                            </button>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        onClick={() => { goToday(); setPickerOpen(false); }}
                        className="mt-2 w-full h-7 rounded-lg border border-line text-xs font-medium text-ink-2 hover:text-ink hover:border-slate-300 dark:hover:border-slate-400/20 transition-colors"
                      >
                        Today
                      </button>
                    </div>
                  </>
                )}
              </div>

              <button
                type="button" aria-label="Next" onClick={() => step(1)}
                className="w-8 h-8 rounded-lg border border-line flex items-center justify-center text-ink-3 hover:text-ink hover:border-slate-300 dark:hover:border-slate-400/20 transition-colors"
              >
                <ChevronRight size={15} />
              </button>
              <button
                type="button" onClick={goToday}
                className="h-8 px-2.5 rounded-lg border border-line text-xs font-medium text-ink-2 hover:text-ink hover:border-slate-300 dark:hover:border-slate-400/20 transition-colors"
              >
                Today
              </button>
            </div>

            <div className="flex items-center gap-2">
              <MultiFilterSelect
                icon={Clock} tone="amber" title="Filter by status"
                options={STATUS_OPTIONS} value={statuses} onChange={setStatuses}
                placeholder="All statuses" noun="statuses"
                className={FILTER_TRIGGER_CLS}
              />
              {assignees && assignees.length > 0 && (
                <MultiFilterSelect
                  icon={Users} tone="blue" title="Filter by owner"
                  options={ownerOptions} value={owners} onChange={setOwners}
                  placeholder="All owners" noun="owners"
                  className={FILTER_TRIGGER_CLS}
                />
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="h-[380px] rounded-xl bg-slate-100 dark:bg-surface-2 animate-pulse" />
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 mb-1">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                  <span key={d} className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 text-center">
                    {d}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {gridDays.map((d) => {
                  const list = byDay.get(dayKey(d)) ?? [];
                  const outside = !isSameMonth(d, anchor);
                  const isSel = isSameDay(d, selected);
                  return (
                    <button
                      key={d.toISOString()}
                      type="button"
                      onClick={() => { setSelected(d); if (outside) setAnchor(d); }}
                      className={cn(
                        'text-left min-h-[84px] rounded-xl border p-1.5 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
                        outside ? 'bg-slate-50/60 dark:bg-surface-2/40 border-line/60' : 'bg-white dark:bg-surface-2 border-line',
                        isToday(d) && !isSel && 'border-blue-300 dark:border-blue-500/40 bg-blue-50/40 dark:bg-blue-500/[0.06]',
                        isSel && 'ring-2 ring-violet-500/70 border-violet-300 dark:border-violet-500/40',
                      )}
                    >
                      <span className={cn(
                        'block text-[11px] font-semibold mb-1 px-0.5',
                        outside ? 'text-ink-3/50' : isToday(d) ? 'text-blue-600 dark:text-blue-400' : 'text-ink-2',
                      )}>
                        {format(d, 'd')}
                      </span>
                      {list.slice(0, 3).map((it) => (
                        <span
                          key={it.id}
                          className={cn(
                            'block truncate text-[10px] leading-tight font-semibold px-1.5 py-[3px] rounded mb-[3px]',
                            STATUS_STYLES[it.status].chip,
                          )}
                        >
                          {it.title}
                        </span>
                      ))}
                      {list.length > 3 && (
                        <span className="block text-[9px] font-semibold text-ink-3 px-1">
                          +{list.length - 3} more
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </SectionCard>

        {/* ── Right rail ────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <SectionCard
            title={format(selected, 'd MMMM')}
            subtitle={`${selectedItems.length} follow-up${selectedItems.length === 1 ? '' : 's'}`}
            icon={CalendarCheck}
            tone="violet"
          >
            {selectedItems.length === 0 ? (
              <EmptyBlock icon={CalendarCheck} message="Nothing scheduled for this day" className="py-6" />
            ) : (
              <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                {selectedItems.map((it) => (
                  <EntryCard
                    key={it.id}
                    item={it}
                    onOpen={open}
                    onReschedule={(date) => reschedule.mutate({ item: it, date })}
                    busy={reschedule.isPending}
                  />
                ))}
              </div>
            )}
          </SectionCard>

          {showOwnerBreakdown && ownerRows.length > 0 ? (
            <SectionCard
              title={ownerBreakdownTitle}
              icon={AlertTriangle}
              tone="rose"
              action={<CountPill>{counts.overdue}</CountPill>}
            >
              <div className="space-y-3">
                {ownerRows.map((r) => (
                  <Link
                    key={r.id}
                    href={`/dashboard/leads?followUp=overdue&owner=${encodeURIComponent(r.id)}`}
                    className="flex items-center gap-3 -mx-2 px-2 py-1 rounded-lg transition-colors hover:bg-rose-500/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/30"
                  >
                    <PersonAvatar name={r.name} />
                    <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-ink">{r.name}</span>
                    <div className="w-24 h-1.5 rounded-full bg-slate-100 dark:bg-surface-2 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-rose-500"
                        style={{ width: `${Math.min(100, (r.count / (ownerRows[0]?.count || 1)) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[13px] font-semibold text-rose-600 dark:text-rose-400 tabular-nums w-6 text-right">
                      {r.count}
                    </span>
                  </Link>
                ))}
              </div>
            </SectionCard>
          ) : (
            <SectionCard
              title="Overdue follow-ups"
              icon={AlertTriangle}
              tone="rose"
              action={overdue.length > 0 ? <CountPill>{overdue.length}</CountPill> : undefined}
            >
              {overdue.length === 0 ? (
                <EmptyBlock icon={CheckCircle2} message="Nothing overdue — all caught up" className="py-6" />
              ) : (
                <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                  {overdue.slice(0, 8).map((it) => {
                    const d = daysBetween(it.followUpDate);
                    return (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => open(it)}
                        className="w-full text-left relative flex items-center gap-3 pl-4 pr-3 py-2.5 rounded-xl border border-line bg-white dark:bg-surface-2 overflow-hidden hover:-translate-y-px hover:border-rose-300 dark:hover:border-rose-500/30 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
                      >
                        <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-rose-500" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13px] font-semibold text-ink truncate">{it.title}</span>
                          <span className="block text-xs text-ink-3 truncate">
                            {prettyType(it.activityType)} · {it.entityType === 'lead' ? 'Lead' : 'Opportunity'}
                            {it.assignedTo ? ` · ${it.assignedTo.name}` : ''}
                          </span>
                        </span>
                        <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 flex-shrink-0">
                          {d <= 0 ? 'Due' : `${d}d`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          )}
        </div>
      </div>
    </>
  );
}

// ── Entry card (day panel) ─────────────────────────────────────────────────

function EntryCard({
  item, onOpen, onReschedule, busy,
}: {
  item: FollowUpItem;
  onOpen: (i: FollowUpItem) => void;
  onReschedule: (date: string) => void;
  busy: boolean;
}) {
  const s = STATUS_STYLES[item.status];
  const Icon = ACTIVITY_ICONS[item.activityType] ?? CalendarCheck;
  const isLead = item.entityType === 'lead';
  const overdueDays = item.status === 'overdue' ? daysBetween(item.followUpDate) : 0;

  return (
    <div className="relative rounded-xl border border-line bg-white dark:bg-surface-2 p-3 pl-4 overflow-hidden">
      <span className={cn('absolute left-0 top-0 bottom-0 w-[3px]', s.rail)} />

      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-[13px] font-semibold text-ink truncate">{item.title}</p>
        <span className={cn('text-[10px] px-2 py-0.5 rounded-md font-semibold flex-shrink-0 uppercase tracking-wide', s.pill)}>
          {s.label}
        </span>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-ink-3 mb-2">
        <Icon size={12} className="flex-shrink-0" />
        {prettyType(item.activityType)} · {isLead ? 'Lead' : 'Opportunity'} · {timeStr(item.followUpDate)}
        {overdueDays > 0 && (
          <span className="text-rose-600 dark:text-rose-400 font-medium">· {overdueDays}d late</span>
        )}
      </p>

      {item.subtitle && <p className="text-xs text-ink-2 mb-2.5 truncate">{item.subtitle}</p>}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onOpen(item)}
          className={cn(
            'inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs font-semibold border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2',
            isLead
              ? 'text-blue-600 dark:text-blue-400 bg-blue-500/[0.06] hover:bg-blue-500/10 border-blue-500/20 focus-visible:ring-blue-500/30'
              : 'text-violet-600 dark:text-violet-400 bg-violet-500/[0.06] hover:bg-violet-500/10 border-violet-500/20 focus-visible:ring-violet-500/30',
          )}
        >
          Open {isLead ? 'Lead' : 'Opportunity'} <ArrowUpRight size={12} />
        </button>

        <label className="inline-flex items-center gap-1 h-7 px-2 rounded-lg text-xs font-medium text-ink-2 bg-slate-500/[0.06] hover:bg-slate-500/10 border border-line cursor-pointer transition-colors duration-150">
          <Clock size={12} />
          <span className="sr-only">Reschedule {item.title}</span>
          <input
            type="date"
            disabled={busy}
            defaultValue={format(new Date(item.followUpDate), 'yyyy-MM-dd')}
            onChange={(e) => e.target.value && onReschedule(e.target.value)}
            className="bg-transparent outline-none text-xs w-[92px] text-ink-2"
          />
        </label>
      </div>
    </div>
  );
}

