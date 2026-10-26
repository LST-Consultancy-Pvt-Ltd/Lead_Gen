'use client';

// Checkbox dropdown for picking several values. Visually matches <Select>: same
// trigger classes (passed in by the caller) and the same portal option menu.

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
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
    setPos({ top: up ? b.top - 6 : b.bottom + 6, left: b.left, width: b.width, up });
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

  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); setActive(0); setOpen(true); }
      return;
    }
    if (!options.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + options.length) % options.length); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[active]) toggle(options[active].value); }
    else if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); }
  }

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
          {value.length > 0 && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange([])}
              className="w-full text-left px-3 py-1.5 mb-1 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10"
            >
              Clear selection
            </button>
          )}
          {options.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-400">No options</p>
          )}
          {options.map((o, i) => {
            const isSel = value.includes(o.value);
            return (
              <div
                key={`${o.value}-${i}`}
                data-idx={i}
                role="option"
                aria-selected={isSel}
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
                    isSel ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 dark:border-slate-600',
                  )}
                >
                  {isSel && <Check size={11} strokeWidth={3} />}
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
