'use client';
import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];

interface PaginationProps {
  /** Current page (1-based) */
  page: number;
  /** Total number of pages */
  totalPages: number;
  /** Current page size */
  pageSize: number;
  /** Called when the user navigates to a different page */
  onPageChange: (page: number) => void;
  /** Called when the user changes how many rows to show per page */
  onPageSizeChange: (size: number) => void;
  /** Optional override for the page-size choices */
  pageSizeOptions?: number[];
  className?: string;
}

export function Pagination({
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  className = '',
}: PaginationProps) {
  const [sizeOpen, setSizeOpen] = useState(false);
  // Local text state so the user can freely type a page number before committing
  const [pageInput, setPageInput] = useState(String(page));

  // Keep the input in sync when the page changes from outside (prev/next, page-size change)
  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  const safeTotal = Math.max(1, totalPages);

  function commitPageInput() {
    const parsed = parseInt(pageInput, 10);
    if (isNaN(parsed)) {
      setPageInput(String(page));
      return;
    }
    const clamped = Math.min(Math.max(1, parsed), safeTotal);
    setPageInput(String(clamped));
    if (clamped !== page) onPageChange(clamped);
  }

  function selectSize(size: number) {
    setSizeOpen(false);
    if (size !== pageSize) onPageSizeChange(size);
  }

  return (
    <div className={`flex items-center gap-3 flex-wrap ${className}`}>
      {/* Page-size selector */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setSizeOpen(o => !o)}
          onBlur={() => setTimeout(() => setSizeOpen(false), 150)}
          className="inline-flex items-center justify-between gap-2 h-9 w-28 px-3 rounded-xl border border-line bg-white dark:bg-sunken shadow-sm dark:shadow-none text-xs font-semibold text-ink dark:text-slate-200 hover:border-blue-400 dark:hover:border-blue-500/50 transition-colors"
          title="Rows per page"
        >
          Show {pageSize}
          <ChevronDown size={14} className={`text-slate-400 transition-transform ${sizeOpen ? 'rotate-180 text-blue-500' : ''}`} />
        </button>
        {sizeOpen && (
          <div className="absolute bottom-full left-0 mb-1.5 w-32 p-1.5 rounded-xl border border-line bg-white dark:bg-surface shadow-2xl shadow-slate-900/15 dark:shadow-black/50 z-20 animate-fade-in">
            {pageSizeOptions.map(size => (
              <button
                key={size}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); selectSize(size); }}
                className={`block w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors ${
                  size === pageSize
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold shadow-sm shadow-blue-500/30'
                    : 'text-ink-2 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-500/10'
                }`}
              >
                Show {size}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Prev button */}
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-line bg-white dark:bg-sunken shadow-sm dark:shadow-none text-ink-2 dark:text-slate-300 enabled:hover:border-blue-400 enabled:hover:text-blue-600 enabled:hover:bg-blue-50 dark:enabled:hover:bg-blue-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        title="Previous page"
        aria-label="Previous page"
      >
        <ChevronLeft size={16} />
      </button>

      {/* Current / total */}
      <span className="text-xs text-ink-3 whitespace-nowrap">
        Page <span className="font-bold text-ink tabular-nums">{page}</span> of <span className="font-semibold tabular-nums">{safeTotal}</span>
      </span>

      {/* Direct page-number input */}
      <input
        type="number"
        min={1}
        max={safeTotal}
        value={pageInput}
        onChange={(e) => setPageInput(e.target.value)}
        onBlur={commitPageInput}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="h-9 w-16 px-2 text-center rounded-xl border border-line bg-white dark:bg-sunken shadow-sm dark:shadow-none text-xs font-semibold text-ink dark:text-slate-200 tabular-nums focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 focus:outline-none transition-all"
        title="Go to page"
        aria-label="Go to page"
      />

      {/* Next button */}
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= safeTotal}
        className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-line bg-white dark:bg-sunken shadow-sm dark:shadow-none text-ink-2 dark:text-slate-300 enabled:hover:border-blue-400 enabled:hover:text-blue-600 enabled:hover:bg-blue-50 dark:enabled:hover:bg-blue-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        title="Next page"
        aria-label="Next page"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
