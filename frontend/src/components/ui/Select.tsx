'use client';

// Drop-in replacement for <select>. A hidden native <select> keeps every prop the
// caller passes (value, onChange, name, ref from react-hook-form register, …), so
// behaviour is unchanged; only the visible trigger and the option menu are custom.
// Picking an option writes the native select's value and dispatches a real
// `change` event, which React delivers to the caller's onChange as usual.

import React, { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

type Opt = { value: string; label: string; disabled?: boolean };

function textOf(node: React.ReactNode): string {
  let out = '';
  React.Children.forEach(node, (c) => {
    if (typeof c === 'string' || typeof c === 'number') out += String(c);
    else if (React.isValidElement(c)) out += textOf((c.props as any).children);
  });
  return out;
}

function collectOptions(children: React.ReactNode, acc: Opt[] = []): Opt[] {
  React.Children.forEach(children, (c) => {
    if (!React.isValidElement(c)) return;
    const props: any = c.props;
    if (c.type === 'option') {
      const label = textOf(props.children).trim();
      acc.push({ value: props.value !== undefined ? String(props.value) : label, label, disabled: !!props.disabled });
    } else if (props?.children) {
      collectOptions(props.children, acc);
    }
  });
  return acc;
}

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  /** Hide the built-in chevron (when the caller draws its own). */
  hideChevron?: boolean;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, hideChevron, style, ...props },
  ref,
) {
  const nativeRef = useRef<HTMLSelectElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean }>({ top: 0, left: 0, width: 0, up: false });
  const [mounted, setMounted] = useState(false);
  const [innerValue, setInnerValue] = useState<string>(
    props.defaultValue !== undefined ? String(props.defaultValue) : '',
  );

  const options = collectOptions(children);
  const controlled = props.value !== undefined;
  const current = controlled ? String(props.value ?? '') : innerValue;
  // Like a native select: with no matching option, the first one is shown
  const selected = options.find((o) => o.value === current) ?? options[0];

  const setRefs = useCallback((el: HTMLSelectElement | null) => {
    nativeRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) (ref as React.MutableRefObject<HTMLSelectElement | null>).current = el;
  }, [ref]);

  useEffect(() => setMounted(true), []);

  // Keep the label in sync for uncontrolled selects (e.g. react-hook-form register/reset)
  useEffect(() => {
    if (controlled) return;
    const el = nativeRef.current;
    if (el && el.value !== innerValue) setInnerValue(el.value);
  });

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

  // Scroll the highlighted option into view
  useEffect(() => {
    if (!open || active < 0) return;
    menuRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function openMenu() {
    if (props.disabled) return;
    const idx = options.findIndex((o) => o.value === current);
    setActive(idx >= 0 ? idx : 0);
    setOpen(true);
  }

  function choose(opt: Opt) {
    if (opt.disabled) return;
    const el = nativeRef.current;
    setOpen(false);
    btnRef.current?.focus();
    if (!el) return;
    if (el.value !== opt.value) {
      el.value = opt.value;
      if (!controlled) setInnerValue(opt.value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // Let blur-based validation (react-hook-form mode: 'onBlur') run
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  function move(delta: number) {
    if (!options.length) return;
    let i = active;
    for (let n = 0; n < options.length; n++) {
      i = (i + delta + options.length) % options.length;
      if (!options[i].disabled) break;
    }
    setActive(i);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openMenu(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[active]) choose(options[active]); }
    else if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); }
    else if (e.key.length === 1) {
      const k = e.key.toLowerCase();
      const start = active + 1;
      for (let n = 0; n < options.length; n++) {
        const i = (start + n) % options.length;
        if (options[i].label.toLowerCase().startsWith(k)) { setActive(i); break; }
      }
    }
  }

  const isPlaceholder = !selected || selected.value === '';

  return (
    <>
      <select {...props} ref={setRefs} hidden tabIndex={-1} aria-hidden="true">
        {children}
      </select>
      <button
        ref={btnRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={(props as any)['aria-label'] ?? props.title}
        title={props.title}
        disabled={props.disabled}
        style={style}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(
          'flex items-center gap-2 text-left cursor-pointer disabled:cursor-not-allowed',
          className,
          open && 'border-blue-500 ring-4 ring-blue-500/15',
        )}
      >
        {/* Stacked grid: hidden copies of every label reserve the widest width (like a native select) */}
        <span className="flex-1 min-w-0 grid">
          {options.map((o, i) => (
            <span key={i} aria-hidden="true" className="col-start-1 row-start-1 invisible h-0 overflow-hidden whitespace-nowrap">{o.label}</span>
          ))}
          <span className={cn('col-start-1 row-start-1 truncate', isPlaceholder && 'text-slate-400 dark:text-slate-500')}>
            {selected?.label || '\u00a0'}
          </span>
        </span>
        {!hideChevron && (
          <ChevronDown
            size={15}
            className={cn('flex-shrink-0 text-slate-400 transition-transform duration-200', open && 'rotate-180 text-blue-500')}
          />
        )}
      </button>
      {open && mounted && createPortal(
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          className="fixed z-[10050] max-h-72 overflow-y-auto rounded-xl border border-line bg-white dark:bg-surface p-1.5 shadow-2xl shadow-slate-900/15 dark:shadow-black/50 animate-fade-in"
          style={{
            left: pos.left,
            minWidth: Math.max(pos.width, 180),
            maxWidth: 'min(420px, calc(100vw - 32px))',
            ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
          }}
        >
          {options.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-400">No options</p>
          )}
          {options.map((o, i) => {
            const isSel = o.value === current;
            const isAct = i === active;
            return (
              <div
                key={`${o.value}-${i}`}
                data-idx={i}
                role="option"
                aria-selected={isSel}
                aria-disabled={o.disabled}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] cursor-pointer select-none transition-colors',
                  o.disabled && 'opacity-40 cursor-not-allowed',
                  isSel
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold shadow-sm shadow-blue-500/30'
                    : isAct
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
                      : 'text-ink-2 dark:text-slate-200',
                  !isSel && o.value === '' && 'text-slate-400 dark:text-slate-500',
                )}
              >
                <span className="flex-1 min-w-0 truncate">{o.label || ' '}</span>
                {isSel && <Check size={14} className="flex-shrink-0" />}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
});
