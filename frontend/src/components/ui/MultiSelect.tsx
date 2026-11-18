'use client';

// Checkbox dropdown for picking several values. Visually matches <Select>: same
// trigger classes (passed in by the caller) and the same portal option menu.

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Minus } from 'lucide-react';
import { cn } from '../../lib/utils';

export type MultiSelectOption = { value: string; label: string };

export type MultiSelectProps = {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  /** Shown when nothing is selected, e.g. "All Status". */
  placeholder: string;
  /** Plural noun for the "3 statuses" summary label. */
  noun?: string;
  title?: string;
  disabled?: boolean;
  triggerClassName?: string;
};

export function MultiSelect({
  options, value, onChange, placeholder, noun = 'selected', title, disabled, triggerClassName,
}: MultiSelectProps) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean }>({ top: 0, left: 0, width: 0, up: false });
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const spaceBelow = window.innerHeight - b.bottom;
    const up = spaceBelow < 280 && b.top > spaceBelow;
    // Keep the menu inside the viewport: a trigger near the right edge would
    // otherwise push the menu off the page.
    const menuW = menuRef.current?.offsetWidth || Math.max(b.width, 180);
    const left = Math.max(8, Math.min(b.left, window.innerWidth - menuW - 8));
    setPos({ top: up ? b.top - 6 : b.bottom + 6, left, width: b.width, up });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onMove = () => place();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open || active < 0) return;
    menuRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  // An empty selection means "no filter", i.e. every row is shown — so the menu
  // draws that state with all boxes ticked, and a click unticks that one box
  // ("all except X"). Ticking everything again collapses back to [] = all.
  //
  // Unticking the last box can't be reported upwards ([] already means all), so
  // it is held as a local "cleared" state: the boxes stay empty while the list
  // behind the menu keeps showing everything, and the next tick selects just
  // that option. It resets when the menu closes.
  const allValues = Array.from(new Set(options.map((o) => o.value)));
  const [cleared, setCleared] = useState(false);
  const noneChosen = value.length === 0 && !cleared;

  useEffect(() => { if (!open) setCleared(false); }, [open]);

  function toggle(v: string) {
    const base = noneChosen ? allValues : value;
    const next = base.includes(v) ? base.filter((x) => x !== v) : [...base, v];
    if (next.length === 0) { setCleared(true); onChange([]); return; }
    setCleared(false);
    onChange(allValues.every((x) => next.includes(x)) ? [] : next);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); setActive(0); setOpen(true); }
      return;
    }
    // Escape/Tab must still close an empty menu (options can be empty while a
    // team or dropdown list is still loading).
    if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); return; }
    if (!options.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + options.length) % options.length); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[active]) toggle(options[active].value); }
  }

  const allSelected = allValues.length > 0 && (noneChosen || allValues.every((v) => value.includes(v)));
  const someSelected = !allSelected && allValues.some((v) => value.includes(v));
  const selectedLabels = options.filter((o) => value.includes(o.value)).map((o) => o.label);
  const label = selectedLabels.length === 0
    ? placeholder
    : selectedLabels.length === 1
      ? selectedLabels[0]
      : `${selectedLabels.length} ${noun}`;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={title}
        title={selectedLabels.length > 1 ? selectedLabels.join(', ') : title}
        disabled={disabled}
        onClick={() => { if (open) setOpen(false); else { setActive(0); setOpen(true); } }}
        onKeyDown={onKeyDown}
        className={cn(
          'flex items-center gap-2 text-left cursor-pointer disabled:cursor-not-allowed',
          triggerClassName,
          open && 'border-blue-500 ring-4 ring-blue-500/15',
        )}
      >
        <span className={cn('flex-1 min-w-0 truncate', selectedLabels.length === 0 && 'text-slate-400 dark:text-slate-500')}>
          {label}
        </span>
        {selectedLabels.length > 1 && (
          <span className="flex-shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-blue-600 text-white text-[11px] font-semibold flex items-center justify-center">
            {selectedLabels.length}
          </span>
        )}
      </button>
      {open && mounted && createPortal(
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          className="fixed z-[10050] max-h-72 overflow-y-auto rounded-xl border border-line bg-white dark:bg-surface p-1.5 shadow-2xl shadow-slate-900/15 dark:shadow-black/50 animate-fade-in"
          style={{
            left: pos.left,
            minWidth: Math.max(pos.width, 180),
            maxWidth: 'min(420px, calc(100vw - 32px))',
            ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
          }}
        >
          {options.length > 0 && (
            <>
              <div
                role="option"
                aria-selected={allSelected}
                onMouseEnter={() => setActive(-1)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setCleared(allSelected); onChange([]); }}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-semibold cursor-pointer select-none transition-colors text-ink-2 dark:text-slate-200 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-500/10 dark:hover:text-blue-300"
              >
                <span
                  className={cn(
                    'flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors',
                    allSelected
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : someSelected
                        ? 'bg-blue-600/15 border-blue-600 text-blue-600 dark:text-blue-400'
                        : 'border-slate-300 dark:border-slate-600',
                  )}
                >
                  {allSelected ? <Check size={11} strokeWidth={3} /> : someSelected ? <Minus size={11} strokeWidth={3} /> : null}
                </span>
                <span className="flex-1 min-w-0 truncate">Select All</span>
              </div>
              <div className="my-1 h-px bg-line dark:bg-white/[0.06]" />
            </>
          )}
          {options.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-400">No options</p>
          )}
          {options.map((o, i) => {
            const isSel = value.includes(o.value);
            const isChecked = noneChosen || isSel;
            return (
              <div
                key={`${o.value}-${i}`}
                data-idx={i}
                role="option"
                aria-selected={isChecked}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggle(o.value)}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] cursor-pointer select-none transition-colors',
                  i === active
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
                    : 'text-ink-2 dark:text-slate-200',
                  isSel && 'font-semibold',
                )}
              >
                <span
                  className={cn(
                    'flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors',
                    isChecked ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 dark:border-slate-600',
                  )}
                >
                  {isChecked && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="flex-1 min-w-0 truncate">{o.label}</span>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * MultiSelect dressed as a standard `.input` filter control (fixed height,
 * chevron on the right) — the shape used by the page filter bars.
 */
export function InputMultiSelect({
  className,
  ...props
}: Omit<MultiSelectProps, 'triggerClassName'> & { className?: string }) {
  return (
    <div className={cn('relative inline-flex', className)}>
      <MultiSelect {...props} triggerClassName="input h-10 py-0 pr-9 text-sm" />
      <ChevronDown
        size={15}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3"
      />
    </div>
  );
}
