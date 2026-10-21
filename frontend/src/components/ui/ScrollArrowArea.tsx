'use client';
import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from 'lucide-react';

type Axis = { client: number; scroll: number; pos: number };

/**
 * Scroll container with a custom vertical (right) and horizontal (bottom)
 * scrollbar: arrow buttons at both ends (click or hold) and a draggable thumb
 * that thickens on hover.
 */
export function ScrollArrowArea({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [x, setX] = useState<Axis>({ client: 0, scroll: 0, pos: 0 });
  const [y, setY] = useState<Axis>({ client: 0, scroll: 0, pos: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      setX({ client: el.clientWidth, scroll: el.scrollWidth, pos: el.scrollLeft });
      setY({ client: el.clientHeight, scroll: el.scrollHeight, pos: el.scrollTop });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);

  const showX = x.scroll > x.client + 1;
  const showY = y.scroll > y.client + 1;

  return (
    <div>
      <div className="flex">
        <div ref={ref} className={`scrollbar-none flex-1 min-w-0 ${className}`}>{children}</div>
        {showY && <ScrollBar horizontal={false} axis={y} target={ref} />}
      </div>
      {showX && (
        <div className={showY ? 'mr-4' : ''}>
          <ScrollBar horizontal axis={x} target={ref} />
        </div>
      )}
    </div>
  );
}

function ScrollBar({ horizontal, axis, target }: { horizontal: boolean; axis: Axis; target: React.RefObject<HTMLDivElement> }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const repeat = useRef<number>();
  const [trackLen, setTrackLen] = useState(0);

  useEffect(() => {
    const t = trackRef.current;
    if (!t) return;
    const ro = new ResizeObserver(() => setTrackLen(horizontal ? t.clientWidth : t.clientHeight));
    ro.observe(t);
    return () => ro.disconnect();
  }, [horizontal]);

  useEffect(() => () => clearInterval(repeat.current), []);

  const maxScroll = Math.max(axis.scroll - axis.client, 1);
  const thumbLen = Math.max((axis.client / axis.scroll) * trackLen, 28);
  const thumbPos = (axis.pos / maxScroll) * Math.max(trackLen - thumbLen, 0);

  const scrollBy = (px: number) => target.current?.scrollBy(horizontal ? { left: px } : { top: px });

  const holdArrow = (dir: 1 | -1) => (e: React.PointerEvent) => {
    e.preventDefault();
    scrollBy(dir * 80);
    clearInterval(repeat.current);
    repeat.current = window.setInterval(() => scrollBy(dir * 30), 50);
  };
  const release = () => clearInterval(repeat.current);

  const dragThumb = (e: React.PointerEvent) => {
    const el = target.current;
    if (!el) return;
    e.preventDefault();
    const start = horizontal ? e.clientX : e.clientY;
    const startScroll = horizontal ? el.scrollLeft : el.scrollTop;
    const ratio = maxScroll / Math.max(trackLen - thumbLen, 1);
    const move = (ev: PointerEvent) => {
      const next = startScroll + ((horizontal ? ev.clientX : ev.clientY) - start) * ratio;
      if (horizontal) el.scrollLeft = next;
      else el.scrollTop = next;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const arrowCls =
    'shrink-0 flex items-center justify-center w-4 h-4 rounded text-ink-3 hover:bg-slate-200 hover:text-ink dark:hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent';
  const Prev = horizontal ? ChevronLeft : ChevronUp;
  const Next = horizontal ? ChevronRight : ChevronDown;

  return (
    <div className={`group flex select-none bg-slate-50/80 dark:bg-white/[0.02] border-line ${horizontal ? 'h-4 border-t' : 'flex-col w-4 border-l'}`}>
      <button type="button" aria-label={horizontal ? 'Scroll left' : 'Scroll up'} disabled={axis.pos <= 1}
        onPointerDown={holdArrow(-1)} onPointerUp={release} onPointerLeave={release} className={arrowCls}>
        <Prev size={12} strokeWidth={2.5} />
      </button>

      <div ref={trackRef} className="relative flex-1">
        <div
          onPointerDown={dragThumb}
          style={horizontal
            ? { width: thumbLen, transform: `translateX(${thumbPos}px)` }
            : { height: thumbLen, transform: `translateY(${thumbPos}px)` }}
          className={`absolute rounded-full bg-slate-400/70 hover:bg-slate-500 dark:bg-white/25 dark:hover:bg-white/40 transition-[height,width,top,left] duration-150 ${
            horizontal ? 'h-1.5 top-[5px] group-hover:h-2.5 group-hover:top-[3px]' : 'w-1.5 left-[5px] group-hover:w-2.5 group-hover:left-[3px]'
          }`}
        />
      </div>

      <button type="button" aria-label={horizontal ? 'Scroll right' : 'Scroll down'} disabled={axis.pos >= maxScroll - 1}
        onPointerDown={holdArrow(1)} onPointerUp={release} onPointerLeave={release} className={arrowCls}>
        <Next size={12} strokeWidth={2.5} />
      </button>
    </div>
  );
}
